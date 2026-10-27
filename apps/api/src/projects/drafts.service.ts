import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, max, ne } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { ProjectDocument, assertDocumentSize, createId } from '@blokum/schema';
import { DB } from '../tokens.js';

/** A snapshot is made from the previous draft when the last one is older than this (E-19). */
export const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
/** Snapshots kept per project; the oldest are dropped. The per-tariff limit joins with Entitlements (P7.1). */
export const SNAPSHOTS_KEPT = 50;

export interface VersionItem {
  id: string;
  number: number;
  kind: 'DRAFT_SNAPSHOT' | 'PUBLISHED';
  createdAt: Date;
}

const sha256 = (doc: unknown): string => createHash('sha256').update(JSON.stringify(doc)).digest('hex');

/** `If-Match` holds the revision the editor loaded: `"12"` or `12`; `*` means «overwrite whatever is there» (E-18). */
export function parseIfMatch(header: string | undefined): number | '*' {
  if (header === undefined || header.trim() === '') {
    throw new HttpException(
      { error: { code: 'REVISION_REQUIRED', message: 'Не указана версия, на основе которой сделаны правки (заголовок If-Match)' } },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const raw = header.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (raw === '*') return '*';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException({ error: { code: 'INVALID_REVISION', message: 'Версия в заголовке If-Match должна быть целым числом' } });
  }
  return n;
}

/** P3.2 · E-17…E-19: the draft of a project — saving with a revision check, history of snapshots, restoring. */
@Injectable()
export class DraftsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** E-17/E-18: replaces the draft if the editor worked on the current revision (or asked to overwrite). */
  async saveDraft(userId: string, projectId: string, ifMatch: string | undefined, input: unknown): Promise<{ revision: number; savedAt: Date }> {
    const expected = parseIfMatch(ifMatch);
    const doc = this.parseDocument(input);
    return this.db.transaction(async (tx) => {
      const project = await this.lockOwned(tx, userId, projectId);
      const draft = await this.currentDraft(tx, project.draftVersionId);
      if (expected !== '*' && draft.number !== expected) {
        throw new ConflictException({
          error: { code: 'REVISION_CONFLICT', message: 'Сборку уже изменили в другой вкладке или на другом устройстве', currentRevision: draft.number },
        });
      }
      await this.snapshotIfDue(tx, projectId, draft, userId);
      const revision = await this.nextNumber(tx, projectId);
      const savedAt = new Date();
      await tx
        .update(schema.projectVersions)
        .set({ document: doc, schemaVersion: doc.schemaVersion, sha256: sha256(doc), number: revision, createdAt: savedAt, createdById: userId })
        .where(eq(schema.projectVersions.id, draft.id));
      await tx.update(schema.projects).set({ title: doc.meta.title, updatedAt: savedAt }).where(eq(schema.projects.id, projectId));
      return { revision, savedAt };
    });
  }

  /** E-19: snapshots and published versions, newest first. */
  async listVersions(userId: string, projectId: string): Promise<VersionItem[]> {
    const project = await this.owned(userId, projectId);
    const rows = await this.db
      .select({ id: schema.projectVersions.id, number: schema.projectVersions.number, kind: schema.projectVersions.kind, createdAt: schema.projectVersions.createdAt })
      .from(schema.projectVersions)
      .where(and(eq(schema.projectVersions.projectId, projectId), project.draftVersionId ? ne(schema.projectVersions.id, project.draftVersionId) : undefined))
      .orderBy(desc(schema.projectVersions.number));
    return rows;
  }

  /** E-19: the document of one version, for the preview in the history window. */
  async getVersion(userId: string, projectId: string, versionId: string): Promise<VersionItem & { document: ProjectDocument }> {
    await this.owned(userId, projectId);
    const row = (
      await this.db
        .select()
        .from(schema.projectVersions)
        .where(and(eq(schema.projectVersions.id, versionId), eq(schema.projectVersions.projectId, projectId)))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException({ error: { code: 'VERSION_NOT_FOUND', message: 'Такой версии нет' } });
    return { id: row.id, number: row.number, kind: row.kind, createdAt: row.createdAt, document: row.document as unknown as ProjectDocument };
  }

  /** E-19: puts a version back as the draft; the draft it replaces is saved as a snapshot first, so nothing is lost. */
  async restoreVersion(userId: string, projectId: string, versionId: string): Promise<{ revision: number; document: ProjectDocument }> {
    return this.db.transaction(async (tx) => {
      const project = await this.lockOwned(tx, userId, projectId);
      const draft = await this.currentDraft(tx, project.draftVersionId);
      const target = (
        await tx
          .select()
          .from(schema.projectVersions)
          .where(and(eq(schema.projectVersions.id, versionId), eq(schema.projectVersions.projectId, projectId)))
          .limit(1)
      )[0];
      if (!target || target.id === draft.id) throw new NotFoundException({ error: { code: 'VERSION_NOT_FOUND', message: 'Такой версии нет' } });
      await this.snapshot(tx, projectId, draft, userId);
      const revision = await this.nextNumber(tx, projectId);
      const doc = this.parseDocument(target.document);
      const now = new Date();
      await tx
        .update(schema.projectVersions)
        .set({ document: doc, schemaVersion: doc.schemaVersion, sha256: sha256(doc), number: revision, createdAt: now, createdById: userId })
        .where(eq(schema.projectVersions.id, draft.id));
      await tx.update(schema.projects).set({ title: doc.meta.title, updatedAt: now }).where(eq(schema.projects.id, projectId));
      return { revision, document: doc };
    });
  }

  private parseDocument(input: unknown): ProjectDocument {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException({ error: { code: 'INVALID_DOCUMENT', message: 'Не передан документ сборки' } });
    }
    const parsed = ProjectDocument.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException({
        error: { code: 'INVALID_DOCUMENT', message: `Сборка не прошла проверку: ${issue?.message ?? 'неверная структура'}`, path: issue?.path.map(String) },
      });
    }
    try {
      assertDocumentSize(JSON.stringify(parsed.data));
    } catch (e) {
      throw new BadRequestException({ error: { code: 'DOCUMENT_TOO_LARGE', message: (e as Error).message } });
    }
    return parsed.data;
  }

  private async owned(userId: string, projectId: string): Promise<{ draftVersionId: string | null }> {
    const row = (
      await this.db
        .select({ ownerId: schema.projects.ownerId, draftVersionId: schema.projects.draftVersionId })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException();
    if (row.ownerId !== userId) throw new ForbiddenException();
    return row;
  }

  /** Same as `owned`, and the project row stays locked until the transaction ends — two saves cannot interleave. */
  private async lockOwned(tx: Tx, userId: string, projectId: string): Promise<{ draftVersionId: string | null }> {
    const row = (
      await tx
        .select({ ownerId: schema.projects.ownerId, draftVersionId: schema.projects.draftVersionId })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
        .for('update')
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException();
    if (row.ownerId !== userId) throw new ForbiddenException();
    return row;
  }

  private async currentDraft(tx: Tx, draftVersionId: string | null) {
    const draft = draftVersionId ? (await tx.select().from(schema.projectVersions).where(eq(schema.projectVersions.id, draftVersionId)).limit(1))[0] : undefined;
    if (!draft) throw new NotFoundException({ error: { code: 'DRAFT_NOT_FOUND', message: 'У сборки нет черновика' } });
    return draft;
  }

  /** The next free number of a version of the project (numbers never repeat, the revision is one of them). */
  private async nextNumber(tx: Tx, projectId: string): Promise<number> {
    const top = (await tx.select({ n: max(schema.projectVersions.number) }).from(schema.projectVersions).where(eq(schema.projectVersions.projectId, projectId)))[0];
    return (top?.n ?? 0) + 1;
  }

  private async snapshotIfDue(tx: Tx, projectId: string, draft: typeof schema.projectVersions.$inferSelect, userId: string): Promise<void> {
    const last = (
      await tx
        .select({ createdAt: schema.projectVersions.createdAt })
        .from(schema.projectVersions)
        .where(and(eq(schema.projectVersions.projectId, projectId), eq(schema.projectVersions.kind, 'DRAFT_SNAPSHOT'), ne(schema.projectVersions.id, draft.id)))
        .orderBy(desc(schema.projectVersions.createdAt))
        .limit(1)
    )[0];
    if (!last || Date.now() - last.createdAt.getTime() >= SNAPSHOT_EVERY_MS) await this.snapshot(tx, projectId, draft, userId);
  }

  /** Copies the draft as it is now into a snapshot and drops the oldest snapshots over the limit. */
  private async snapshot(tx: Tx, projectId: string, draft: typeof schema.projectVersions.$inferSelect, userId: string): Promise<void> {
    await tx.insert(schema.projectVersions).values({
      id: createId(),
      projectId,
      number: await this.nextNumber(tx, projectId),
      document: draft.document,
      schemaVersion: draft.schemaVersion,
      sha256: draft.sha256,
      kind: 'DRAFT_SNAPSHOT',
      createdById: userId,
      createdAt: draft.createdAt,
    });
    const all = await tx
      .select({ id: schema.projectVersions.id })
      .from(schema.projectVersions)
      .where(and(eq(schema.projectVersions.projectId, projectId), eq(schema.projectVersions.kind, 'DRAFT_SNAPSHOT'), ne(schema.projectVersions.id, draft.id)))
      .orderBy(asc(schema.projectVersions.number));
    for (const old of all.slice(0, Math.max(0, all.length - SNAPSHOTS_KEPT))) {
      await tx.delete(schema.projectVersions).where(eq(schema.projectVersions.id, old.id));
    }
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
