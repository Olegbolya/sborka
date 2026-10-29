import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createDocument, createId, createSlug, ProjectDocument, ThemeTokens, validateDocument, walkBlocks } from '@blokum/schema';
import { Inject, Optional } from '@nestjs/common';
import { FeatureFlagsService } from '../admin/feature-flags.service.js';
import { DB } from '../tokens.js';
import { hashPassword } from '../play/secrets.js';

/** The settings of access the cabinet may write (PL-06…PL-10); the password goes separately and is stored as a hash. */
const ACCESS_SETTING_KEYS = ['maxStarts', 'maxCompletions', 'scheduledOpenAt', 'scheduledCloseAt', 'age18', 'singleAttempt', 'closedText'] as const;

export interface ProjectSettings {
  /** PL-06 · at most so many started and/or completed passages. */
  maxStarts?: number;
  maxCompletions?: number;
  scheduledOpenAt?: string | null;
  scheduledCloseAt?: string | null;
  /** PL-08 · the password is kept only as a hash (`passwordHash`); the plain text is never stored or returned. */
  passwordHash?: string;
  /** What the cabinet sends to set (`string`) or remove (`''`) the password; never stored. */
  password?: string;
  hasPassword?: boolean;
  /** PL-09 · the screen «Вам есть 18 лет?» before the first screen. */
  age18?: boolean;
  /** PL-10 · one passage per device. */
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

export interface AdMarking {
  advertiser: string;
  inn?: string;
  erid: string;
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
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly flags?: FeatureFlagsService,
  ) {}

  async createProject(userId: string, title = 'Новая сборка'): Promise<ProjectDetail> {
    const projectId = createId();
    const slug = createSlug();
    const doc = createDocument({ title });
    // TH-03: a project starts with the theme its owner made the default.
    const [theme] = await this.db
      .select({ id: schema.themes.id, tokens: schema.themes.tokens })
      .from(schema.themes)
      .where(and(eq(schema.themes.ownerId, userId), eq(schema.themes.isDefault, true), isNull(schema.themes.deletedAt)));
    if (theme) {
      const tokens = ThemeTokens.safeParse(theme.tokens);
      if (tokens.success) doc.theme = { themeId: theme.id, tokens: tokens.data };
    }
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
      settings: this.forOwner((row.settings ?? {})),
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
      await this.publish(row);
      return;
    }
    await this.db.update(schema.projects).set({ status }).where(eq(schema.projects.id, projectId));
  }

  /**
   * L-08, SC-07, PL-23 · publishing: the draft is checked (errors block, warnings do not), and a copy of it becomes the
   * published version — the player reads that copy, so later edits of the draft or of a theme reach participants only at
   * the next publication.
   */
  private async publish(row: { id: string; operatorInfo: Record<string, unknown> | null; dpaAcceptedAt: Date | null }): Promise<void> {
    await this.flags?.require('PUBLISHING_ENABLED', 'Публикация сборок временно отключена.');
    const [project] = await this.db.select({ draftVersionId: schema.projects.draftVersionId }).from(schema.projects).where(eq(schema.projects.id, row.id));
    const [draft] = project?.draftVersionId
      ? await this.db.select({ document: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, project.draftVersionId))
      : [];
    if (!draft) throw new BadRequestException({ error: { code: 'NO_DRAFT', message: 'У сборки нет черновика, который можно опубликовать.' } });
    await this.checkPdRequirements(row.id, row.operatorInfo, row.dpaAcceptedAt);
    const parsed = ProjectDocument.safeParse(draft.document);
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: 'INVALID_DOCUMENT', message: `Сборка не прошла проверку: ${parsed.error.issues[0]?.message ?? 'неверная структура'}` } });
    }
    const doc = parsed.data;
    const errors = validateDocument(doc).filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        error: {
          code: 'PUBLISH_BLOCKED',
          message: `Сборку нельзя опубликовать, пока не исправлены ошибки: ${errors.length}.`,
          issues: errors.map((i) => ({ code: i.code, message: i.message, path: i.path })),
        },
      });
    }
    await this.db.transaction(async (tx) => {
      await tx.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, row.id)).for('update');
      const [last] = await tx.select({ n: max(schema.projectVersions.number) }).from(schema.projectVersions).where(eq(schema.projectVersions.projectId, row.id));
      const versionId = createId();
      await tx.insert(schema.projectVersions).values({
        id: versionId,
        projectId: row.id,
        number: (last?.n ?? 0) + 1,
        document: doc,
        schemaVersion: doc.schemaVersion,
        sha256: sha256(doc),
        kind: 'PUBLISHED',
      });
      await tx
        .update(schema.projects)
        .set({ status: 'PUBLISHED', publishedVersionId: versionId, publishedAt: new Date(), themeId: doc.theme.themeId ?? null })
        .where(eq(schema.projects.id, row.id));
    });
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

  /** PL-18 · the project is advertising: who advertises and the erid; the player shows them under «Реклама». `null` — not advertising. */
  async setAdvertising(userId: string, projectId: string, body: { advertiser?: unknown; inn?: unknown; erid?: unknown } | null): Promise<AdMarking | null> {
    await this.assertOwner(userId, projectId);
    if (body === null || (body.advertiser === undefined && body.erid === undefined)) {
      await this.db.update(schema.projects).set({ isAdvertising: false, adMarking: null }).where(eq(schema.projects.id, projectId));
      return null;
    }
    const advertiser = typeof body.advertiser === 'string' ? body.advertiser.trim() : '';
    const erid = typeof body.erid === 'string' ? body.erid.trim() : '';
    const inn = typeof body.inn === 'string' ? body.inn.replace(/\s/g, '') : '';
    if (advertiser.length < 2 || advertiser.length > 200) throw new UnprocessableEntityException({ error: { code: 'AD_ADVERTISER', message: 'Укажите рекламодателя: наименование или ФИО (от 2 до 200 знаков).' } });
    if (!/^[A-Za-z0-9]{4,64}$/.test(erid)) throw new UnprocessableEntityException({ error: { code: 'AD_ERID', message: 'Укажите токен рекламы (erid): латинские буквы и цифры, от 4 знаков.' } });
    if (inn !== '' && !/^(\d{10}|\d{12})$/.test(inn)) throw new UnprocessableEntityException({ error: { code: 'AD_INN', message: 'ИНН — 10 или 12 цифр.' } });
    const ad: AdMarking = { advertiser, erid, ...(inn ? { inn } : {}) };
    await this.db.update(schema.projects).set({ isAdvertising: true, adMarking: ad }).where(eq(schema.projects.id, projectId));
    return ad;
  }

  async getAdvertising(userId: string, projectId: string): Promise<AdMarking | null> {
    const row = await this.assertOwner(userId, projectId);
    return row.isAdvertising && row.adMarking ? row.adMarking : null;
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

  /** The settings as the cabinet sees them: the password hash is replaced by the sign that there is a password. */
  private forOwner(settings: ProjectSettings): ProjectSettings {
    const { passwordHash, password: _password, ...rest } = settings;
    return passwordHash ? { ...rest, hasPassword: true } : rest;
  }

  async getAccessSettings(userId: string, projectId: string): Promise<ProjectSettings> {
    const row = await this.assertOwner(userId, projectId);
    return this.forOwner((row.settings ?? {}));
  }

  async updateAccessSettings(userId: string, projectId: string, settings: Partial<ProjectSettings>): Promise<ProjectSettings> {
    const row = await this.assertOwner(userId, projectId);
    const { password } = settings;
    // ASVS V5.1.2: only the settings the cabinet offers are taken from the body; nothing else (the hash of the password, a key
    // somebody invented) gets into the stored settings.
    const incoming: Record<string, unknown> = {};
    for (const key of ACCESS_SETTING_KEYS) if (key in settings) incoming[key] = (settings as Record<string, unknown>)[key];
    const bad = () => new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'Настройка указана неверно.' } });
    for (const key of ['scheduledOpenAt', 'scheduledCloseAt'] as const) {
      const v = incoming[key];
      if (v !== undefined && v !== null && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) throw bad();
    }
    for (const key of ['age18', 'singleAttempt'] as const) {
      const v = incoming[key];
      if (v !== undefined && v !== null && typeof v !== 'boolean') throw bad();
    }
    if (incoming.closedText !== undefined && incoming.closedText !== null && (typeof incoming.closedText !== 'string' || incoming.closedText.length > 1000)) throw bad();
    const merged: ProjectSettings = { ...((row.settings ?? {}) as ProjectSettings), ...(incoming as Partial<ProjectSettings>) };
    for (const key of ['maxStarts', 'maxCompletions'] as const) {
      const v = merged[key];
      if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 1 || v > 10_000_000)) {
        throw new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'Лимит — целое число от 1.' } });
      }
    }
    // PL-08: a new password replaces the hash, an empty one removes it.
    if (typeof password === 'string') {
      if (password === '') delete merged.passwordHash;
      else if (password.length < 4 || password.length > 100) throw new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'Пароль — от 4 до 100 знаков.' } });
      else merged.passwordHash = await hashPassword(password);
    }
    delete merged.password;
    await this.db
      .update(schema.projects)
      .set({ settings: merged as Record<string, unknown> })
      .where(eq(schema.projects.id, projectId));
    return this.forOwner(merged);
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
        isAdvertising: schema.projects.isAdvertising,
        adMarking: schema.projects.adMarking,
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
