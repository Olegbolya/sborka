import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, count, eq, gt, gte, inArray, ne } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { externalLinks, foldDomain, usedMediaIds, publishWarnings, heavyMediaWarnings, REPORT_SLA_HOURS, scanDocument, type ProjectDocument, type SafetyDictionary, type SafetyIssue } from '@blokum/schema';
import { AuditLogService } from '../auth/audit-log.service.js';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB, LINK_REPUTATION } from '../tokens.js';
import { fail } from './errors.js';
import { ModerationService, SYSTEM_ACTOR } from './moderation.service.js';
import { type LinkReputation } from './safe-browsing.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** TS-03: an account younger than this has its publication looked at by a person when it names a bank, a state body or a brand. */
export const YOUNG_ACCOUNT_DAYS = 30;
/** TS-06: the first hours of an account, in which it publishes little and sends nobody away. */
export const NEW_ACCOUNT_HOURS = 24;
export const NEW_ACCOUNT_MAX_PUBLISHED = 2;
export const NEW_ACCOUNT_MAX_VIDEO_MS = 30_000;
/** TS-02: so many blocked attempts with a «password» field in a day are a flag for the moderators. */
export const PHISHING_ATTEMPTS_FLAG = 3;

export interface TermView {
  id: string;
  kind: 'STOP' | 'DOMAIN';
  term: string;
  category: 'A' | 'B' | null;
  weight: number;
  active: boolean;
  note: string;
  createdAt: Date;
}

/** What the check says about a publication. */
export interface PublishVerdict {
  /** Stop the publication: the creator fixes these. */
  errors: SafetyIssue[];
  /** A person looks: the report categories and a text for the case. */
  reviews: SafetyIssue[];
  /** The publication of this account waits for the person (a young account that names a brand), instead of only being flagged. */
  hold: boolean;
  /** Said to the creator when the publication goes on. */
  warnings: string[];
}

/**
 * P9.1 · SR-01, TS-02…TS-05 · the dictionaries and what is done with what they find: the creator is stopped (errors), a person
 * looks (a case in the queue), or a young account's publication waits. The administrator keeps the dictionaries.
 */
@Injectable()
export class SafetyService {
  private readonly log = new Logger(SafetyService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogService,
    private readonly moderation: ModerationService,
    @Optional() @Inject(LINK_REPUTATION) private readonly reputation?: LinkReputation | null,
    @Optional() @Inject(API_CONFIG) private readonly config?: ApiConfig,
  ) {}

  // ── The dictionaries in the admin (TS-04, TS-05) ──────────────────────────

  async list(): Promise<TermView[]> {
    return this.db.select().from(schema.safetyTerms).orderBy(asc(schema.safetyTerms.kind), asc(schema.safetyTerms.category), asc(schema.safetyTerms.term));
  }

  async dictionary(): Promise<SafetyDictionary> {
    const rows = await this.db.select().from(schema.safetyTerms).where(eq(schema.safetyTerms.active, true));
    return {
      stopTerms: rows.filter((r) => r.kind === 'STOP' && r.category).map((r) => ({ id: r.id, text: r.term, category: r.category!, weight: r.weight })),
      blockedDomains: rows.filter((r) => r.kind === 'DOMAIN').map((r) => r.term),
    };
  }

  private parse(body: Record<string, unknown>, partial: boolean): { kind?: 'STOP' | 'DOMAIN'; term?: string; category?: 'A' | 'B' | null; weight?: number; active?: boolean; note?: string } {
    const out: { kind?: 'STOP' | 'DOMAIN'; term?: string; category?: 'A' | 'B' | null; weight?: number; active?: boolean; note?: string } = {};
    if (!partial || body.kind !== undefined) {
      if (body.kind !== 'STOP' && body.kind !== 'DOMAIN') throw fail(422, 'KIND', 'Выберите, что добавить: слово или сайт.');
      out.kind = body.kind;
    }
    if (!partial || body.term !== undefined) {
      const raw = typeof body.term === 'string' ? body.term.trim() : '';
      if (raw.length < 2 || raw.length > 120) throw fail(422, 'TERM', 'Слово или сайт — от 2 до 120 знаков.');
      out.term = raw;
    }
    if (!partial || body.weight !== undefined) {
      const w = body.weight === undefined ? 50 : Number(body.weight);
      if (!Number.isInteger(w) || w < 1 || w > 100) throw fail(422, 'WEIGHT', 'Вес — целое число от 1 до 100.');
      out.weight = w;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw fail(422, 'ACTIVE', 'Включено или выключено — да или нет.');
      out.active = body.active;
    }
    if (body.note !== undefined) {
      const n = typeof body.note === 'string' ? body.note.trim() : '';
      if (n.length > 300) throw fail(422, 'NOTE', 'Заметка — до 300 знаков.');
      out.note = n;
    }
    if (body.category !== undefined || !partial) {
      if (body.category === 'A' || body.category === 'B') out.category = body.category;
      else if (body.category === undefined || body.category === null || body.category === '') out.category = null;
      else throw fail(422, 'CATEGORY', 'Категория — A или B.');
    }
    return out;
  }

  async create(actorId: string, body: Record<string, unknown>, ip?: string): Promise<TermView> {
    const v = this.parse(body, false);
    const term = v.kind === 'DOMAIN' ? foldDomain(v.term!) : v.term!.toLowerCase();
    if (term.length < 2) throw fail(422, 'TERM', 'Слово или сайт — от 2 знаков.');
    if (v.kind === 'STOP' && !v.category) throw fail(422, 'CATEGORY', 'Для слова выберите категорию — A или B.');
    if (v.kind === 'DOMAIN' && !term.includes('.')) throw fail(422, 'TERM', 'Сайт записывается так: example.com.');
    const [dup] = await this.db.select({ id: schema.safetyTerms.id }).from(schema.safetyTerms).where(and(eq(schema.safetyTerms.kind, v.kind!), eq(schema.safetyTerms.term, term)));
    if (dup) throw fail(409, 'TERM_EXISTS', 'Такое уже есть в списке.');
    const [row] = await this.db
      .insert(schema.safetyTerms)
      .values({ kind: v.kind!, term, category: v.kind === 'STOP' ? v.category! : null, weight: v.kind === 'STOP' ? v.weight! : 100, note: v.note ?? '', createdById: actorId })
      .returning();
    await this.audit.log({ actorId, action: 'SAFETY_TERM_CREATED', targetType: 'SAFETY_TERM', targetId: row!.id, ...(ip ? { ip } : {}), meta: { kind: v.kind, term, weight: row!.weight } });
    return row!;
  }

  async update(actorId: string, id: string, body: Record<string, unknown>, ip?: string): Promise<TermView> {
    const v = this.parse({ ...body, kind: undefined, term: undefined }, true);
    const [current] = await this.db.select().from(schema.safetyTerms).where(eq(schema.safetyTerms.id, id));
    if (!current) throw fail(404, 'NOT_FOUND', 'Такого слова нет в списке.');
    const set: Partial<typeof schema.safetyTerms.$inferInsert> = {};
    if (v.weight !== undefined && current.kind === 'STOP') set.weight = v.weight;
    if (v.active !== undefined) set.active = v.active;
    if (v.note !== undefined) set.note = v.note;
    if (v.category !== undefined && current.kind === 'STOP' && v.category) set.category = v.category;
    if (Object.keys(set).length === 0) return current;
    const [row] = await this.db.update(schema.safetyTerms).set(set).where(eq(schema.safetyTerms.id, id)).returning();
    await this.audit.log({ actorId, action: 'SAFETY_TERM_CHANGED', targetType: 'SAFETY_TERM', targetId: id, ...(ip ? { ip } : {}), meta: { term: current.term, ...set } });
    return row!;
  }

  async remove(actorId: string, id: string, ip?: string): Promise<void> {
    const [row] = await this.db.delete(schema.safetyTerms).where(eq(schema.safetyTerms.id, id)).returning();
    if (!row) throw fail(404, 'NOT_FOUND', 'Такого слова нет в списке.');
    await this.audit.log({ actorId, action: 'SAFETY_TERM_DELETED', targetType: 'SAFETY_TERM', targetId: id, ...(ip ? { ip } : {}), meta: { kind: row.kind, term: row.term } });
  }

  // ── The check of a publication (SR-01) ────────────────────────────────────

  /** What the dictionaries and the links say about the document the owner is going to publish. */
  async check(ownerId: string, doc: ProjectDocument, projectTitle: string, now = new Date(), projectId?: string): Promise<PublishVerdict> {
    const dict = await this.dictionary();
    const issues = scanDocument(doc, dict, projectTitle);
    const errors = issues.filter((i) => i.severity === 'error');
    errors.push(...(await this.newAccountLimits(ownerId, doc, now, projectId)));
    // TS-05: Yandex Safe Browsing. A failure of the service does not stop the creator — the own rules above already ran.
    if (this.reputation && errors.length === 0) {
      try {
        const bad = await this.reputation.check(externalLinks(doc));
        for (const b of bad) errors.push({ code: 'LINK_BLOCKED', severity: 'error', path: ['links'], term: b.url, category: 'A6', message: `Яндекс считает эту ссылку опасной (${b.url}). Ссылку на такой сайт разместить нельзя.` });
      } catch (e) {
        this.log.warn(`Safe Browsing не ответил: ${e instanceof Error ? e.message : 'ошибка'}`);
      }
    }
    const reviews = issues.filter((i) => i.severity === 'review');
    const [owner] = await this.db.select({ createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, ownerId));
    const young = !owner || now.getTime() - owner.createdAt.getTime() < YOUNG_ACCOUNT_DAYS * DAY_MS;
    // TS-03: a brand in the text — a young account's publication waits for a person, an older account gets a warning.
    const brandOnly = reviews.filter((i) => i.code === 'BRAND');
    const hold = young && brandOnly.length > 0;
    const mediaIds = usedMediaIds(doc);
    const sizes = new Map<string, number>();
    if (mediaIds.length > 0) {
      for (const m of await this.db.select({ id: schema.media.id, bytes: schema.media.bytes }).from(schema.media).where(inArray(schema.media.id, mediaIds))) sizes.set(m.id, Number(m.bytes));
    }
    // SR-01: warnings do not stop the publication.
    const warnings = [...(!young ? brandOnly.map((i) => i.message) : []), ...publishWarnings(doc).map((w) => w.message), ...heavyMediaWarnings(doc, sizes).map((w) => w.message)];
    return { errors, reviews: young ? reviews : reviews.filter((i) => i.code !== 'BRAND'), hold, warnings };
  }

  /**
   * TS-06 · the first 24 hours of an account: at most two published projects, no links to other sites, videos up to 30 seconds.
   * An account without a confirmed phone (it came through VK / Яндекс without one) may not send people to other sites at all.
   */
  async newAccountLimits(ownerId: string, doc: ProjectDocument, now: Date, projectId?: string): Promise<SafetyIssue[]> {
    // Off only in the e2e run (NEW_ACCOUNT_HOURS=0): its test accounts have no phone and publish many projects. The API tests check the rules.
    if (this.config?.newAccountHours === 0) return [];
    const [owner] = await this.db.select({ createdAt: schema.users.createdAt, phone: schema.users.phoneE164 }).from(schema.users).where(eq(schema.users.id, ownerId));
    if (!owner) return [];
    const isNew = now.getTime() - owner.createdAt.getTime() < (this.config?.newAccountHours ?? NEW_ACCOUNT_HOURS) * HOUR_MS;
    const out: SafetyIssue[] = [];
    const links = externalLinks(doc);
    if (links.length > 0 && !owner.phone) {
      out.push({ code: 'PHONE_LINK', severity: 'error', path: ['links'], term: links[0]!, category: 'A3', message: 'Пока в аккаунте нет подтверждённого номера телефона, ссылки на другие сайты запрещены. Уберите ссылки — тогда сборку можно будет опубликовать.' });
    } else if (links.length > 0 && isNew) {
      out.push({ code: 'NEW_ACCOUNT_LINK', severity: 'error', path: ['links'], term: links[0]!, category: 'A3', message: 'В первые сутки после регистрации ссылки на другие сайты запрещены. Уберите ссылки или опубликуйте сборку завтра.' });
    }
    if (!isNew) return out;
    const published = await this.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.ownerId, ownerId), eq(schema.projects.status, 'PUBLISHED'), projectId ? ne(schema.projects.id, projectId) : undefined));
    if (published.length >= NEW_ACCOUNT_MAX_PUBLISHED) {
      out.push({ code: 'NEW_ACCOUNT_LIMIT', severity: 'error', path: ['project'], message: `В первые сутки после регистрации можно опубликовать не больше ${NEW_ACCOUNT_MAX_PUBLISHED} сборок. Попробуйте завтра.` });
    }
    const mediaIds = usedMediaIds(doc);
    if (mediaIds.length > 0) {
      const long = await this.db
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(and(inArray(schema.media.id, mediaIds), eq(schema.media.kind, 'VIDEO'), gt(schema.media.durationMs, NEW_ACCOUNT_MAX_VIDEO_MS)));
      if (long.length > 0) {
        out.push({ code: 'NEW_ACCOUNT_VIDEO', severity: 'error', path: ['media', long[0]!.id], message: `В первые сутки после регистрации видео в сборке не длиннее ${NEW_ACCOUNT_MAX_VIDEO_MS / 1000} секунд. Сократите видео или опубликуйте сборку завтра.` });
      }
    }
    return out;
  }

  /** A blocked attempt to publish a field that asks for a password or a card: it is written down, and the third in a day is a flag (TS-02). */
  async noteBlocked(ownerId: string, projectId: string, errors: readonly SafetyIssue[], now = new Date()): Promise<void> {
    const phishing = errors.filter((e) => e.code === 'PHISHING_FIELD');
    if (phishing.length === 0) return;
    await this.audit.log({ actorId: ownerId, action: 'PUBLISH_BLOCKED_PHISHING', targetType: 'PROJECT', targetId: projectId, meta: { terms: phishing.map((p) => p.term) } });
    const [n] = await this.db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actorId, ownerId), eq(schema.auditLog.action, 'PUBLISH_BLOCKED_PHISHING'), gte(schema.auditLog.createdAt, new Date(now.getTime() - DAY_MS))));
    if ((n?.n ?? 0) === PHISHING_ATTEMPTS_FLAG) {
      await this.openCase(projectId, 'A2', 'P1', `Автоматически: ${PHISHING_ATTEMPTS_FLAG} попытки за сутки опубликовать сборку с полем, где просят пароль, код или данные карты (${[...new Set(phishing.map((p) => p.term))].join(', ')}).`, now);
    }
  }

  /** After the publication: what a person must look at becomes a case in the queue; a young account's publication waits for it. */
  async afterPublish(projectId: string, verdict: PublishVerdict, now = new Date()): Promise<void> {
    if (verdict.reviews.length === 0) return;
    const text = verdict.reviews.map((r) => `${r.term ? `«${r.term}»` : ''} — ${r.message}`).join('\n');
    const worst = verdict.reviews.find((r) => r.category?.startsWith('A')) ?? verdict.reviews[0]!;
    await this.openCase(projectId, worst.category ?? 'C', 'P1', `Автоматическая проверка перед публикацией:\n${text}`.slice(0, 4000), now);
    if (verdict.hold) {
      await this.moderation.act({ id: SYSTEM_ACTOR, role: 'SYSTEM' }, { targetType: 'PROJECT', targetId: projectId, action: 'UNPUBLISH', reasonCode: 'AUTO_REVIEW', note: `Автоматически: ${verdict.reviews.map((r) => r.term ?? r.code).join(', ')}.` }, undefined, now);
    }
  }

  private async openCase(projectId: string, category: string, priority: 'P1' | 'P2', text: string, now: Date): Promise<void> {
    // A republication with the same words does not make a second case while the first waits.
    const [open] = await this.db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(and(eq(schema.reports.projectId, projectId), eq(schema.reports.reporterIpHash, 'auto:publish'), eq(schema.reports.category, category), inArray(schema.reports.status, ['NEW', 'IN_REVIEW'])))
      .limit(1);
    if (open) return;
    const [project] = await this.db.select({ versionId: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, projectId));
    await this.db.insert(schema.reports).values({
      projectId,
      snapshotVersionId: project?.versionId ?? null,
      category,
      text,
      reporterIpHash: 'auto:publish',
      priority,
      slaDueAt: new Date(now.getTime() + REPORT_SLA_HOURS[priority] * HOUR_MS),
    });
  }
}
