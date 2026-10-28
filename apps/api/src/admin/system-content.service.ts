import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { AuditLogService } from '../auth/audit-log.service.js';
import { type RequestUser } from '../auth/session.service.js';
import { DB } from '../tokens.js';
import { fail } from './errors.js';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const name = (v: unknown, what: string): string => {
  const t = text(v);
  if (t.length < 2 || t.length > 100) throw fail(422, 'NAME', `${what}: от 2 до 100 знаков.`);
  return t;
};

/** AD-11 · system templates and themes: the administrator publishes any project as a template and any theme as a system one, and takes them down. */
@Injectable()
export class SystemContentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogService,
  ) {}

  private async cover(v: unknown): Promise<string | null> {
    const id = text(v);
    if (id === '') return null;
    const [m] = await this.db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, id));
    if (!m) throw fail(404, 'NOT_FOUND', 'Обложка не найдена среди файлов');
    return id;
  }

  /** The document of a project as the creator last had it: the draft, or the published one when there is no draft. */
  private async projectDocument(projectId: string): Promise<{ document: Record<string, unknown>; title: string }> {
    const [p] = await this.db
      .select({ title: schema.projects.title, draft: schema.projects.draftVersionId, published: schema.projects.publishedVersionId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)));
    if (!p) throw fail(404, 'NOT_FOUND', 'Сборка не найдена');
    const versionId = p.draft ?? p.published;
    const [v] = versionId ? await this.db.select({ document: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, versionId)) : [];
    if (!v) throw fail(409, 'NO_DOCUMENT', 'У сборки пока нет содержимого.');
    return { document: v.document, title: p.title };
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  templates() {
    return this.db
      .select({ id: schema.templates.id, name: schema.templates.name, category: schema.templates.category, sort: schema.templates.sort, coverMediaId: schema.templates.coverMediaId, sourceProjectId: schema.templates.sourceProjectId, publishedAt: schema.templates.publishedAt })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)))
      .orderBy(asc(schema.templates.category), asc(schema.templates.sort), desc(schema.templates.createdAt));
  }

  async publishTemplate(actor: RequestUser, body: Record<string, unknown>, ip?: string): Promise<{ id: string }> {
    const projectId = text(body.projectId);
    if (projectId === '') throw fail(422, 'PROJECT', 'Укажите сборку.');
    const { document, title } = await this.projectDocument(projectId);
    const templateName = text(body.name) === '' ? title : name(body.name, 'Название шаблона');
    const category = text(body.category) || null;
    if (category && category.length > 60) throw fail(422, 'CATEGORY', 'Категория: не больше 60 знаков.');
    const sort = Number.isInteger(Number(body.sort)) ? Number(body.sort) : 0;
    const [row] = await this.db
      .insert(schema.templates)
      .values({ ownerId: null, name: templateName, category, document, sourceProjectId: projectId, isSystem: true, sort, coverMediaId: await this.cover(body.coverMediaId), publishedAt: new Date() })
      .returning({ id: schema.templates.id });
    await this.audit.log({ actorId: actor.id, action: 'SYSTEM_TEMPLATE_PUBLISHED', targetType: 'TEMPLATE', targetId: row!.id, ...(ip ? { ip } : {}), meta: { projectId } });
    return { id: row!.id };
  }

  async updateTemplate(actor: RequestUser, id: string, body: Record<string, unknown>, ip?: string): Promise<void> {
    const set: Partial<typeof schema.templates.$inferInsert> = {};
    if (body.name !== undefined) set.name = name(body.name, 'Название шаблона');
    if (body.category !== undefined) set.category = text(body.category) || null;
    if (body.sort !== undefined) {
      if (!Number.isInteger(Number(body.sort))) throw fail(422, 'SORT', 'Порядок — целое число.');
      set.sort = Number(body.sort);
    }
    if (body.coverMediaId !== undefined) set.coverMediaId = await this.cover(body.coverMediaId);
    if (Object.keys(set).length === 0) throw fail(422, 'EMPTY', 'Нечего менять.');
    const rows = await this.db.update(schema.templates).set(set).where(and(eq(schema.templates.id, id), eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt))).returning({ id: schema.templates.id });
    if (rows.length === 0) throw fail(404, 'NOT_FOUND', 'Шаблон не найден');
    await this.audit.log({ actorId: actor.id, action: 'SYSTEM_TEMPLATE_UPDATED', targetType: 'TEMPLATE', targetId: id, ...(ip ? { ip } : {}) });
  }

  async removeTemplate(actor: RequestUser, id: string, ip?: string): Promise<void> {
    const rows = await this.db.update(schema.templates).set({ deletedAt: new Date() }).where(and(eq(schema.templates.id, id), eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt))).returning({ id: schema.templates.id });
    if (rows.length === 0) throw fail(404, 'NOT_FOUND', 'Шаблон не найден');
    await this.audit.log({ actorId: actor.id, action: 'SYSTEM_TEMPLATE_REMOVED', targetType: 'TEMPLATE', targetId: id, ...(ip ? { ip } : {}) });
  }

  // ── Themes ─────────────────────────────────────────────────────────────────

  themes() {
    return this.db
      .select({ id: schema.themes.id, name: schema.themes.name, coverMediaId: schema.themes.coverMediaId, publishedAt: schema.themes.publishedAt })
      .from(schema.themes)
      .where(and(eq(schema.themes.isSystem, true), isNotNull(schema.themes.publishedAt), isNull(schema.themes.deletedAt)))
      .orderBy(asc(schema.themes.name));
  }

  /** A theme of any creator — or the theme inside any project — becomes a system theme: a copy, so what the creator does later does not change it. */
  async publishTheme(actor: RequestUser, body: Record<string, unknown>, ip?: string): Promise<{ id: string }> {
    const themeId = text(body.themeId);
    const projectId = text(body.projectId);
    if ((themeId === '') === (projectId === '')) throw fail(422, 'SOURCE', 'Укажите либо тему, либо сборку, из которой взять тему.');
    let tokens: Record<string, unknown>;
    let title: string;
    if (themeId) {
      const [t] = await this.db.select({ tokens: schema.themes.tokens, name: schema.themes.name }).from(schema.themes).where(and(eq(schema.themes.id, themeId), isNull(schema.themes.deletedAt)));
      if (!t) throw fail(404, 'NOT_FOUND', 'Тема не найдена');
      tokens = t.tokens;
      title = t.name;
    } else {
      const { document, title: projectTitle } = await this.projectDocument(projectId);
      const inside = (document.theme as { tokens?: Record<string, unknown> } | undefined)?.tokens;
      if (!inside) throw fail(409, 'NO_THEME', 'В сборке нет своей темы.');
      tokens = inside;
      title = `Тема «${projectTitle}»`;
    }
    const themeName = text(body.name) === '' ? title : name(body.name, 'Название темы');
    const [row] = await this.db
      .insert(schema.themes)
      .values({ ownerId: null, name: themeName, tokens, isSystem: true, coverMediaId: await this.cover(body.coverMediaId), publishedAt: new Date() })
      .returning({ id: schema.themes.id });
    await this.audit.log({ actorId: actor.id, action: 'SYSTEM_THEME_PUBLISHED', targetType: 'THEME', targetId: row!.id, ...(ip ? { ip } : {}), meta: { themeId: themeId || null, projectId: projectId || null } });
    return { id: row!.id };
  }

  async removeTheme(actor: RequestUser, id: string, ip?: string): Promise<void> {
    const rows = await this.db.update(schema.themes).set({ deletedAt: new Date() }).where(and(eq(schema.themes.id, id), eq(schema.themes.isSystem, true), isNull(schema.themes.deletedAt))).returning({ id: schema.themes.id });
    if (rows.length === 0) throw fail(404, 'NOT_FOUND', 'Системная тема не найдена');
    await this.audit.log({ actorId: actor.id, action: 'SYSTEM_THEME_REMOVED', targetType: 'THEME', targetId: id, ...(ip ? { ip } : {}) });
  }
}
