import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createDocument, createId, createSlug, type ProjectDocument, walkBlocks } from '@blokum/schema';
import { Inject } from '@nestjs/common';
import { DB } from '../tokens.js';

export interface ProjectSettings {
  maxCompletions?: number;
  scheduledOpenAt?: string;
  scheduledCloseAt?: string;
  password?: string;
  singleAttempt?: boolean;
  closedText?: string;
}

/** PL-23: operator info required when publishing a project with B-19 contacts block. */
export interface OperatorInfo {
  name: string;
  email: string;
  inn?: string;
  purpose: string;
  retentionPeriod: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  starts: number;
  completions: number;
  updatedAt: Date;
  createdAt: Date;
}

export interface ProjectDetail extends Omit<ProjectSummary, 'starts' | 'completions'> {
  document: ProjectDocument | null;
  draftVersionId: string | null;
  draftVersionNumber: number | null;
  settings: ProjectSettings;
  starts: number;
  completions: number;
}

function sha256(doc: ProjectDocument): string {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

async function getCounters(db: Db, projectId: string): Promise<{ starts: number; completions: number }> {
  const rows = await db
    .select({ kind: schema.limitCounters.kind, value: schema.limitCounters.value })
    .from(schema.limitCounters)
    .where(eq(schema.limitCounters.projectId, projectId));
  const starts = rows.find((r) => r.kind === 'STARTS')?.value ?? 0;
  const completions = rows.find((r) => r.kind === 'COMPLETIONS')?.value ?? 0;
  return { starts, completions };
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createProject(userId: string, title = 'Новая сборка'): Promise<ProjectDetail> {
    const projectId = createId();
    const slug = createSlug();
    const doc = createDocument({ title });
    const docJson = doc as unknown as schema.ProjectDocumentJson;
    const versionId = createId();

    const defaultPointId = createId();
    const defaultPointCode = createId(8);

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.projects).values({
        id: projectId,
        ownerId: userId,
        title,
        slug,
        status: 'DRAFT',
      });
      await tx.insert(schema.projectVersions).values({
        id: versionId,
        projectId,
        number: 1,
        document: docJson,
        schemaVersion: doc.schemaVersion,
        sha256: sha256(doc),
        kind: 'DRAFT_SNAPSHOT',
        createdById: userId,
      });
      await tx.update(schema.projects).set({ draftVersionId: versionId }).where(eq(schema.projects.id, projectId));
      // Q-01: auto-create a default access point for every new project.
      await tx.insert(schema.accessPoints).values({
        id: defaultPointId,
        projectId,
        code: defaultPointCode,
        kind: 'LINK',
        label: 'Основная ссылка',
        active: true,
      });
    });

    return {
      id: projectId,
      title,
      slug,
      status: 'DRAFT',
      document: doc,
      draftVersionId: versionId,
      draftVersionNumber: 1,
      settings: {},
      starts: 0,
      completions: 0,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
  }

  async listProjects(userId: string, opts: { search?: string; status?: string } = {}): Promise<ProjectSummary[]> {
    const rows = await this.db
      .select({
        id: schema.projects.id,
        title: schema.projects.title,
        slug: schema.projects.slug,
        status: schema.projects.status,
        updatedAt: schema.projects.updatedAt,
        createdAt: schema.projects.createdAt,
      })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.ownerId, userId),
          isNull(schema.projects.deletedAt),
          opts.status ? eq(schema.projects.status, opts.status as 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'BLOCKED' | 'DELETED') : undefined,
        ),
      )
      .orderBy(desc(schema.projects.updatedAt));

    const withSearch = opts.search
      ? rows.filter((r) => r.title.toLowerCase().includes(opts.search!.toLowerCase()))
      : rows;

    if (withSearch.length === 0) return [];

    const ids = withSearch.map((r) => r.id);
    const counters = await this.db
      .select({ projectId: schema.limitCounters.projectId, kind: schema.limitCounters.kind, value: schema.limitCounters.value })
      .from(schema.limitCounters)
      .where(inArray(schema.limitCounters.projectId, ids));

    return withSearch.map((r) => {
      const starts = counters.find((c) => c.projectId === r.id && c.kind === 'STARTS')?.value ?? 0;
      const completions = counters.find((c) => c.projectId === r.id && c.kind === 'COMPLETIONS')?.value ?? 0;
      return { ...r, starts, completions };
    });
  }

  async getProject(userId: string, projectId: string): Promise<ProjectDetail> {
    const rows = await this.db
      .select({
        id: schema.projects.id,
        ownerId: schema.projects.ownerId,
        title: schema.projects.title,
        slug: schema.projects.slug,
        status: schema.projects.status,
        settings: schema.projects.settings,
        updatedAt: schema.projects.updatedAt,
        createdAt: schema.projects.createdAt,
        deletedAt: schema.projects.deletedAt,
        draftVersionId: schema.projects.draftVersionId,
        versionId: schema.projectVersions.id,
        versionNumber: schema.projectVersions.number,
        document: schema.projectVersions.document,
      })
      .from(schema.projects)
      .leftJoin(schema.projectVersions, eq(schema.projects.draftVersionId, schema.projectVersions.id))
      .where(eq(schema.projects.id, projectId));

    const row = rows[0];
    if (!row || row.deletedAt) throw new NotFoundException();
    if (row.ownerId !== userId) throw new ForbiddenException();

    const { starts, completions } = await getCounters(this.db, projectId);

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      document: row.document ? (row.document as unknown as ProjectDocument) : null,
      draftVersionId: row.draftVersionId ?? null,
      draftVersionNumber: row.versionNumber ?? null,
      settings: (row.settings ?? {}) as unknown as ProjectSettings,
      starts,
      completions,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  }

  async updateProject(userId: string, projectId: string, data: { title?: string }): Promise<ProjectSummary> {
    const project = await this.assertOwner(userId, projectId);
    if (data.title !== undefined) {
      await this.db.update(schema.projects).set({ title: data.title }).where(eq(schema.projects.id, projectId));
    }
    const { starts, completions } = await getCounters(this.db, projectId);
    return {
      id: project.id,
      title: data.title ?? project.title,
      slug: project.slug,
      status: project.status,
      starts,
      completions,
      updatedAt: new Date(),
      createdAt: project.createdAt,
    };
  }

  async deleteProject(userId: string, projectId: string): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.db.update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, projectId));
  }

  async restoreProject(userId: string, projectId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.projects.id, ownerId: schema.projects.ownerId, deletedAt: schema.projects.deletedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    const project = rows[0];
    if (!project) throw new NotFoundException();
    if (project.ownerId !== userId) throw new ForbiddenException();
    if (!project.deletedAt) throw new BadRequestException('Сборка не удалена');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (project.deletedAt < thirtyDaysAgo) throw new BadRequestException('Срок восстановления истёк');
    await this.db.update(schema.projects).set({ deletedAt: null }).where(eq(schema.projects.id, projectId));
  }

  async duplicateProject(userId: string, projectId: string): Promise<ProjectDetail> {
    const source = await this.getProject(userId, projectId);
    const newId = createId();
    const newSlug = createSlug();
    const newVersionId = createId();
    const doc = source.document ?? createDocument({ title: source.title });
    const docJson = doc as unknown as schema.ProjectDocumentJson;

    const dupPointId = createId();
    const dupPointCode = createId(8);

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.projects).values({
        id: newId,
        ownerId: userId,
        title: `${source.title} (копия)`,
        slug: newSlug,
        status: 'DRAFT',
      });
      await tx.insert(schema.projectVersions).values({
        id: newVersionId,
        projectId: newId,
        number: 1,
        document: docJson,
        schemaVersion: doc.schemaVersion,
        sha256: sha256(doc),
        kind: 'DRAFT_SNAPSHOT',
        createdById: userId,
      });
      await tx.update(schema.projects).set({ draftVersionId: newVersionId }).where(eq(schema.projects.id, newId));
      await tx.insert(schema.accessPoints).values({
        id: dupPointId,
        projectId: newId,
        code: dupPointCode,
        kind: 'LINK',
        label: 'Основная ссылка',
        active: true,
      });
    });

    return {
      id: newId,
      title: `${source.title} (копия)`,
      slug: newSlug,
      status: 'DRAFT',
      document: doc,
      draftVersionId: newVersionId,
      draftVersionNumber: 1,
      settings: {},
      starts: 0,
      completions: 0,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
  }

  async setProjectStatus(userId: string, projectId: string, status: 'PUBLISHED' | 'CLOSED' | 'DRAFT'): Promise<void> {
    const row = await this.assertOwner(userId, projectId);
    if (status === 'PUBLISHED') {
      await this.checkPdRequirements(row.id, row.operatorInfo, row.dpaAcceptedAt);
    }
    await this.db.update(schema.projects).set({ status }).where(eq(schema.projects.id, projectId));
  }

  /** PL-23: check that operator info and DPA are set if document has B-19 contacts blocks. */
  private async checkPdRequirements(
    projectId: string,
    operatorInfo: Record<string, unknown> | null,
    dpaAcceptedAt: Date | null,
  ): Promise<void> {
    const versions = await this.db
      .select({ document: schema.projectVersions.document })
      .from(schema.projectVersions)
      .where(and(eq(schema.projectVersions.projectId, projectId), eq(schema.projectVersions.kind, 'DRAFT_SNAPSHOT')))
      .orderBy(desc(schema.projectVersions.number))
      .limit(1);
    const doc = versions[0]?.document as ProjectDocument | undefined;
    if (!doc) return;
    const hasContactsBlock = doc.screens.some((screen) => {
      for (const block of walkBlocks(screen.blocks)) {
        if (block.type === 'contacts') return true;
      }
      return false;
    });
    if (!hasContactsBlock) return;
    if (!operatorInfo || !operatorInfo['name'] || !operatorInfo['email'] || !operatorInfo['purpose'] || !operatorInfo['retentionPeriod']) {
      throw new BadRequestException({
        error: { code: 'OPERATOR_INFO_REQUIRED', message: 'Сборка содержит сбор контактных данных. Заполните сведения об операторе ПД перед публикацией.' },
      });
    }
    if (!dpaAcceptedAt) {
      throw new BadRequestException({
        error: { code: 'DPA_REQUIRED', message: 'Примите условия поручения обработки персональных данных (D6) перед публикацией.' },
      });
    }
  }

  /** PL-23: set operator info for participant PD collection. */
  async setOperatorInfo(userId: string, projectId: string, info: OperatorInfo): Promise<OperatorInfo> {
    await this.assertOwner(userId, projectId);
    await this.db
      .update(schema.projects)
      .set({ operatorInfo: info as unknown as Record<string, unknown> })
      .where(eq(schema.projects.id, projectId));
    return info;
  }

  /** PL-23: record DPA (D6) acceptance for this project. */
  async acceptDpa(userId: string, projectId: string): Promise<{ acceptedAt: Date }> {
    await this.assertOwner(userId, projectId);
    const acceptedAt = new Date();
    await this.db.update(schema.projects).set({ dpaAcceptedAt: acceptedAt }).where(eq(schema.projects.id, projectId));
    return { acceptedAt };
  }

  /** PL-23: get operator info and DPA status. */
  async getOperatorInfo(
    userId: string,
    projectId: string,
  ): Promise<{ operatorInfo: OperatorInfo | null; dpaAcceptedAt: Date | null }> {
    const row = await this.assertOwner(userId, projectId);
    return {
      operatorInfo: row.operatorInfo ? (row.operatorInfo as unknown as OperatorInfo) : null,
      dpaAcceptedAt: row.dpaAcceptedAt,
    };
  }

  async getAccessSettings(userId: string, projectId: string): Promise<ProjectSettings> {
    const row = await this.assertOwner(userId, projectId);
    return (row.settings ?? {});
  }

  async updateAccessSettings(userId: string, projectId: string, settings: Partial<ProjectSettings>): Promise<ProjectSettings> {
    const row = await this.assertOwner(userId, projectId);
    const merged: ProjectSettings = { ...((row.settings ?? {}) as unknown as ProjectSettings), ...settings };
    await this.db
      .update(schema.projects)
      .set({ settings: merged as Record<string, unknown> })
      .where(eq(schema.projects.id, projectId));
    return merged;
  }

  private async assertOwner(userId: string, projectId: string) {
    const rows = await this.db
      .select({
        id: schema.projects.id,
        ownerId: schema.projects.ownerId,
        title: schema.projects.title,
        slug: schema.projects.slug,
        status: schema.projects.status,
        settings: schema.projects.settings,
        operatorInfo: schema.projects.operatorInfo,
        dpaAcceptedAt: schema.projects.dpaAcceptedAt,
        createdAt: schema.projects.createdAt,
        deletedAt: schema.projects.deletedAt,
      })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)));
    const row = rows[0];
    if (!row) throw new NotFoundException();
    if (row.ownerId !== userId) throw new ForbiddenException();
    return row;
  }
}
