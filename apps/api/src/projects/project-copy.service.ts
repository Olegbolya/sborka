import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@blokum/db';
import { ProjectDocument, createId } from '@blokum/schema';
import { DB } from '../tokens.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { LocalStorageService } from '../media/storage.js';
import { ProjectsService, type ProjectDetail, type ProjectSettings } from './projects.service.js';

const unavailable = () => new NotFoundException({ error: { code: 'COPY_UNAVAILABLE', message: 'Эту сборку нельзя скопировать: автор не разрешил копирование или сборка снята с публикации.' } });

/** ids of the creator's own media and fonts the document refers to (`{source:'media', id}` and `{kind:'font', id}`). */
function referenced(doc: unknown): { media: Set<string>; fonts: Set<string> } {
  const media = new Set<string>();
  const fonts = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.source === 'media' && typeof o.id === 'string') media.add(o.id);
      if (o.kind === 'font' && typeof o.id === 'string') fonts.add(o.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(doc);
  return { media, fonts };
}

/** The document with every reference to a copied file or font pointed at the copy; references to the library stay. */
function repoint(doc: unknown, media: Map<string, string>, fonts: Map<string, string>): unknown {
  if (Array.isArray(doc)) return doc.map((v) => repoint(v, media, fonts));
  if (!doc || typeof doc !== 'object') return doc;
  const o = doc as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = repoint(v, media, fonts);
  if (o.source === 'media' && typeof o.id === 'string' && media.has(o.id)) out.id = media.get(o.id);
  if (o.kind === 'font' && typeof o.id === 'string' && fonts.has(o.id)) out.id = fonts.get(o.id);
  return out;
}

/**
 * ADR-120 · «Скопировать себе»: anybody signed in gets a whole independent copy of a published project whose creator allowed it
 * (setting `allowCopy`, only on «Автор» and up — checked again at every copy, so a creator back on «Старт» stops it).
 *
 * The copy is of the published version: screens, blocks, scenarios, variables, theme — the correct answers and scores too, the
 * creator chose to share them. Answers, statistics, access settings and the password are not copied. The creator's own files and
 * fonts are copied into the new owner's account (new ids, the files themselves copied on disk), so the copy keeps working when the
 * creator deletes theirs; they count towards the new owner's storage. A project behind a password is never copied.
 */
@Injectable()
export class ProjectCopyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly entitlements: EntitlementsService,
    private readonly storage: LocalStorageService,
    private readonly projects: ProjectsService,
  ) {}

  /** Whether the player offers «Скопировать себе» for this published project. */
  async copyable(ownerId: string, settings: ProjectSettings): Promise<boolean> {
    if (settings.allowCopy !== true || settings.passwordHash) return false;
    return (await this.entitlements.planOf(ownerId)).limits.allowCopy === true;
  }

  async copyBySlug(userId: string, slug: string): Promise<ProjectDetail> {
    const [row] = await this.db
      .select({
        id: schema.projects.id,
        ownerId: schema.projects.ownerId,
        title: schema.projects.title,
        status: schema.projects.status,
        moderationStatus: schema.projects.moderationStatus,
        settings: schema.projects.settings,
        document: schema.projectVersions.document,
      })
      .from(schema.projects)
      .innerJoin(schema.projectVersions, eq(schema.projects.publishedVersionId, schema.projectVersions.id))
      .where(and(eq(schema.projects.slug, slug), isNull(schema.projects.deletedAt)));
    if (!row || row.status !== 'PUBLISHED' || row.moderationStatus === 'BLOCKED' || !row.ownerId) throw unavailable();
    if (!(await this.copyable(row.ownerId, (row.settings ?? {})))) throw unavailable();

    const source = ProjectDocument.parse(row.document);
    const refs = referenced(source);
    const fontRows = refs.fonts.size
      ? await this.db
          .select()
          .from(schema.fonts)
          .where(and(eq(schema.fonts.ownerId, row.ownerId), inArray(schema.fonts.id, [...refs.fonts]), isNull(schema.fonts.deletedAt)))
      : [];
    // The files of the fonts are media too; they are copied with the rest.
    for (const f of fontRows) for (const style of Object.values(f.styles)) refs.media.add(style.mediaId);
    const mediaRows = refs.media.size
      ? await this.db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.ownerId, row.ownerId), inArray(schema.media.id, [...refs.media]), isNull(schema.media.deletedAt)))
      : [];

    // 04-TARIFFS: the copied files count towards the storage of the new owner.
    if (userId !== row.ownerId && mediaRows.length > 0) {
      const adding = mediaRows.reduce((n, m) => n + m.bytes, 0);
      const [used] = await this.db
        .select({ bytes: sql<string>`coalesce(sum(${schema.media.bytes}), 0)` })
        .from(schema.media)
        .where(and(eq(schema.media.ownerId, userId), isNull(schema.media.deletedAt)));
      const limit = (await this.entitlements.planOf(userId)).limits.storageBytes;
      if (Number(used?.bytes ?? 0) + adding > limit) {
        throw new HttpException({ error: { code: 'PLAN_LIMIT', message: 'В вашем хранилище не хватает места для файлов этой сборки. Освободите место или перейдите на тариф выше.' } }, 402);
      }
    }

    const mediaIds = new Map<string, string>();
    const fontIds = new Map<string, string>();
    if (userId !== row.ownerId) {
      for (const m of mediaRows) mediaIds.set(m.id, createId());
      for (const f of fontRows) fontIds.set(f.id, createId());
      // Files first: a row is written only for a file that is on disk.
      for (const m of mediaRows) await this.copyFiles(row.ownerId, m.id, userId, mediaIds.get(m.id)!, m.variants);
      if (mediaRows.length > 0) {
        await this.db.insert(schema.media).values(
          mediaRows.map((m) => ({
            ...m,
            id: mediaIds.get(m.id)!,
            ownerId: userId,
            variants: this.repointVariants(m.variants, row.ownerId, m.id, userId, mediaIds.get(m.id)!),
            legalHold: false,
            createdAt: new Date(),
          })),
        );
      }
      if (fontRows.length > 0) {
        await this.db.insert(schema.fonts).values(
          fontRows.map((f) => ({
            ...f,
            id: fontIds.get(f.id)!,
            ownerId: userId,
            styles: Object.fromEntries(Object.entries(f.styles).map(([k, v]) => [k, { mediaId: mediaIds.get(v.mediaId) ?? v.mediaId }])),
            createdAt: new Date(),
          })),
        );
      }
    }

    const copied = ProjectDocument.parse(repoint(source, mediaIds, fontIds));
    // The theme is carried in the document; the creator's saved theme stays theirs.
    delete copied.theme.themeId;
    return this.projects.createFromDocument(userId, `${row.title}`.slice(0, 120), copied, 'copy');
  }

  /** The stored files of one media item (the source, the re-encoded file and its width variants) under the new owner and id. */
  private async copyFiles(fromOwner: string, fromId: string, toOwner: string, toId: string, variants: unknown): Promise<void> {
    const names = new Set<string>([fromId]);
    for (const v of Object.values((variants ?? {}) as Record<string, unknown>)) {
      if (typeof v !== 'string') continue;
      const name = path.basename(v);
      if (name === fromId || name.startsWith(`${fromId}.`) || name.startsWith(`${fromId}_`)) names.add(name);
    }
    await mkdir(path.dirname(this.storage.getPath(`${toOwner}/${toId}`)), { recursive: true });
    for (const name of names) {
      const target = `${toOwner}/${toId}${name.slice(fromId.length)}`;
      try {
        await copyFile(this.storage.getPath(`${fromOwner}/${name}`), this.storage.getPath(target));
      } catch (e) {
        // The source of an image is deleted after re-encoding: only the files that exist are copied.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }

  /** Paths in `variants` point at the new owner's folder and the new id (same shape as the worker writes them). */
  private repointVariants(variants: unknown, fromOwner: string, fromId: string, toOwner: string, toId: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((variants ?? {}) as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        out[k] = v;
        continue;
      }
      const name = path.basename(v);
      if (name !== fromId && !name.startsWith(`${fromId}.`) && !name.startsWith(`${fromId}_`)) {
        out[k] = v;
        continue;
      }
      const renamed = `${toId}${name.slice(fromId.length)}`;
      out[k] = path.isAbsolute(v) ? this.storage.getPath(`${toOwner}/${renamed}`) : path.posix.join(path.posix.dirname(v).replace(fromOwner, toOwner), renamed);
    }
    return out;
  }
}
