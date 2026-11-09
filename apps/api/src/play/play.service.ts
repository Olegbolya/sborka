import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { FeatureFlagsService } from '../admin/feature-flags.service.js';
import { NotificationsService } from '../admin/notifications.service.js';
import { hashIp } from '../auth/ip-hash.js';
import { and, count, eq, gt, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createId, type ProjectDocument, type PublicDocument, type ThemeTokens, toPublicDocument } from '@blokum/schema';
import { API_CONFIG, DB } from '../tokens.js';
import { type ApiConfig } from '../config.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { LocalStorageService, servedKey } from '../media/storage.js';
import { type ProjectSettings } from '../projects/projects.service.js';
import { checkUnlockToken, deviceHash, unlockToken, verifyPassword } from './secrets.js';

/** The first state a participant meets (docs/01-PRODUCT-SPEC.md §10.3). */
export type PlayView = PlayOpen | PlayBlocked;

export interface PlayOpen {
  state: 'ok';
  projectId: string;
  versionId: string;
  slug: string;
  title: string;
  description: string;
  /** Own picture for link previews (PL-04): a media file of the published version. */
  ogImageId: string | null;
  /** noindex by default (PL-05); a paid tariff may allow indexing. */
  indexable: boolean;
  document: PublicDocument;
  /**
   * Kinds of the media the document refers to, so the player draws a picture, a video or a sound as it should.
   * TS-24: entries with `stub` are not available to serve but need a placeholder in the player.
   */
  media: Record<string, { kind: string; mime: string; stub?: 'processing' | 'blocked' }>;
  /**
   * TH-04: пользовательские шрифты, используемые в документе.
   * fontId → { family: "bk-font-{fontId}", styles: { "400": mediaId, "700": mediaId2 } }
   */
  fonts: Record<string, { family: string; styles: Record<string, string> }>;
  /** PL-16 · the tariff of the creator asks for the mark «Сделано в Блоккере — создать свою». */
  watermark: boolean;
  /** PL-18 · an advertising project says so: who advertises and the erid. */
  ad: { advertiser: string; inn?: string; erid: string } | null;
  /** Given after the right password: the browser keeps it for the tab and sends it with later calls (PL-08). */
  unlock?: string;
}

/** A state with no document: the theme is enough to draw it. */
export interface PlayBlocked {
  state: 'not_open' | 'closed' | 'password' | 'age18';
  slug: string;
  projectId: string;
  title: string;
  /** What the creator wrote for this state, or the standard text. */
  text: string;
  opensAt?: string;
  theme: ThemeTokens;
  /** The proof of the password, when the next gate («18+») is still ahead. */
  unlock?: string;
}

/** What the browser says about itself; the server trusts none of it beyond what it can check. */
export interface PlayContext {
  unlock?: string | undefined;
  ageConfirmed?: boolean | undefined;
  now?: Date;
}

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);
const unavailable = (): HttpException => fail(404, 'UNAVAILABLE', 'Недоступно');

const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export interface UsageNotice {
  kind: 'usage-80' | 'usage-100';
  title: string;
  body: string;
}

/** P7.2 · PL-07: the message to the creator when `used` passages are reached of `limit`; null when this start crosses nothing. `projectTitle` is set for the pass «Праздник», whose limit is the project's. */
export function usageNotice(used: number, limit: number, projectTitle: string | null): UsageNotice | null {
  if (limit < 1) return null;
  const where = projectTitle ? `сборки «${projectTitle.slice(0, 80)}» за срок пропуска` : 'в этом месяце';
  if (used === limit) {
    return {
      kind: 'usage-100',
      title: 'Лимит прохождений исчерпан',
      body: `Использовано ${used} из ${limit} прохождений ${where}. Новые участники увидят «Временно недоступно», а те, кто уже начал, смогут закончить. Чтобы сборка снова принимала участников, перейдите на тариф с большим лимитом в разделе «Тарифы».`,
    };
  }
  if (used === Math.ceil(limit * 0.8)) {
    return {
      kind: 'usage-80',
      title: 'Использовано 80 % прохождений',
      body: `Использовано ${used} из ${limit} прохождений ${where}. Когда лимит закончится, новые участники не смогут начать. Если ждёте ещё гостей, подключите тариф с большим лимитом в разделе «Тарифы».`,
    };
  }
  return null;
}

/** An unfinished passage counts against the completion limit only while it is fresh. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TRIES = 10;
const PASSWORD_WINDOW_MS = 10 * 60 * 1000;

/** PL-16, PL-18 · what the player must show whatever the creator drew: the tariff's mark and the advertising label. */
function marks(p: { isAdvertising: boolean; adMarking: { advertiser: string; inn?: string; erid: string } | null }, watermark: boolean): Pick<PlayOpen, 'watermark' | 'ad'> {
  return { watermark, ad: p.isAdvertising && p.adMarking ? p.adMarking : null };
}

export function deviceTypeOf(userAgent: string | undefined): 'PHONE' | 'TABLET' | 'DESKTOP' | 'UNKNOWN' {
  if (!userAgent) return 'UNKNOWN';
  if (/iPad|Tablet|Nexus 7|SM-T\d/i.test(userAgent)) return 'TABLET';
  if (/Mobi|iPhone|Android/i.test(userAgent)) return 'PHONE';
  return 'DESKTOP';
}

/** PL-01…PL-10 · what the player reads: the published copy of a project, whether it can be opened now, and admission. */
@Injectable()
export class PlayService {
  private readonly tries = new Map<string, { n: number; since: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly storage: LocalStorageService,
    private readonly entitlements: EntitlementsService,
    @Optional() private readonly flags?: FeatureFlagsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async published(by: { slug: string } | { projectId: string }) {
    // AD-07: with the player off every project answers «Недоступно».
    if (this.flags && !(await this.flags.isEnabled('PLAYER_ENABLED'))) throw unavailable();
    const [row] = await this.db
      .select({
        id: schema.projects.id,
        ownerId: schema.projects.ownerId,
        slug: schema.projects.slug,
        title: schema.projects.title,
        status: schema.projects.status,
        moderationStatus: schema.projects.moderationStatus,
        settings: schema.projects.settings,
        isAdvertising: schema.projects.isAdvertising,
        adMarking: schema.projects.adMarking,
        versionId: schema.projectVersions.id,
        document: schema.projectVersions.document,
      })
      .from(schema.projects)
      .innerJoin(schema.projectVersions, eq(schema.projects.publishedVersionId, schema.projectVersions.id))
      .where(and('slug' in by ? eq(schema.projects.slug, by.slug) : eq(schema.projects.id, by.projectId), isNull(schema.projects.deletedAt)));
    // 1. Exists, published, not blocked — otherwise «Недоступно» without telling why.
    if (!row || row.status !== 'PUBLISHED' || row.moderationStatus === 'BLOCKED') throw unavailable();
    return { ...row, doc: row.document as unknown as ProjectDocument, settings: (row.settings ?? {}) as ProjectSettings };
  }

  private async counters(projectId: string): Promise<{ starts: number; completions: number }> {
    const rows = await this.db.select({ kind: schema.limitCounters.kind, value: schema.limitCounters.value }).from(schema.limitCounters).where(eq(schema.limitCounters.projectId, projectId));
    return { starts: rows.find((r) => r.kind === 'STARTS')?.value ?? 0, completions: rows.find((r) => r.kind === 'COMPLETIONS')?.value ?? 0 };
  }

  /** 2 and 3 of §10.3: the schedule and the limits of the creator (PL-06): null when the project is open. */
  private async closedReason(p: Awaited<ReturnType<PlayService['published']>>, now: Date): Promise<{ state: 'not_open' | 'closed'; text: string; opensAt?: string } | null> {
    const closedText = p.settings.closedText?.trim() || p.doc.theme.tokens.systemScreens.closed.text || 'Сборка закрыта';
    const opens = p.settings.scheduledOpenAt ? new Date(p.settings.scheduledOpenAt) : null;
    const closes = p.settings.scheduledCloseAt ? new Date(p.settings.scheduledCloseAt) : null;
    if (opens && now < opens) return { state: 'not_open', text: `Откроется ${opens.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' })} (МСК)`, opensAt: opens.toISOString() };
    if (closes && now >= closes) return { state: 'closed', text: closedText };
    if (p.settings.maxStarts || p.settings.maxCompletions) {
      const { starts, completions } = await this.counters(p.id);
      if ((p.settings.maxStarts && starts >= p.settings.maxStarts) || (p.settings.maxCompletions && completions >= p.settings.maxCompletions)) return { state: 'closed', text: closedText };
    }
    return null;
  }

  private unlocked(p: Awaited<ReturnType<PlayService['published']>>, token: string | undefined): boolean {
    return !p.settings.passwordHash || checkUnlockToken(this.config.totpSecretKey, p.id, p.settings.passwordHash, token);
  }

  /** The open project of a published version for a participant who is already in it (resuming a passage). */
  async openFor(projectId: string, versionId: string): Promise<PlayOpen> {
    const [row] = await this.db
      .select({ slug: schema.projects.slug, ownerId: schema.projects.ownerId, title: schema.projects.title, isAdvertising: schema.projects.isAdvertising, adMarking: schema.projects.adMarking, document: schema.projectVersions.document })
      .from(schema.projectVersions)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectVersions.projectId))
      .where(and(eq(schema.projectVersions.id, versionId), eq(schema.projects.id, projectId)));
    if (!row) throw unavailable();
    const doc = row.document as unknown as ProjectDocument;
    const fontsMap = await this.fontsOf(row.ownerId, doc);
    const media = await this.mediaOf(row.ownerId, doc);
    // Добавляем WOFF2 медиафайлы шрифтов в карту media
    for (const [, fontInfo] of Object.entries(fontsMap)) {
      for (const [, mid] of Object.entries(fontInfo.styles)) {
        media[mid] = { kind: 'FONT_SOURCE', mime: 'font/woff2' };
      }
    }
    return {
      state: 'ok',
      projectId,
      versionId,
      slug: row.slug,
      title: doc.meta.title,
      description: doc.meta.description,
      ogImageId: doc.meta.ogImage?.source === 'media' ? doc.meta.ogImage.id : null,
      indexable: false,
      document: toPublicDocument(doc),
      media,
      fonts: fontsMap,
      ...marks(row, (await this.entitlements.limitsOfProject(row.ownerId, projectId)).plan.limits.watermark),
    };
  }

  async view(slug: string, ctx: PlayContext = {}): Promise<PlayView> {
    const now = ctx.now ?? new Date();
    const p = await this.published({ slug });
    const blocked = (state: PlayBlocked['state'], text: string, opensAt?: string): PlayBlocked => ({ state, slug: p.slug, projectId: p.id, title: p.title, text, ...(opensAt ? { opensAt } : {}), theme: p.doc.theme.tokens });
    const closed = await this.closedReason(p, now);
    if (closed) return blocked(closed.state, closed.text, closed.opensAt);
    // 5. Password, 6. «18+»: the document is not sent before they are passed.
    if (!this.unlocked(p, ctx.unlock)) return blocked('password', p.doc.theme.tokens.systemScreens.password.text || 'Введите пароль, чтобы открыть');
    if (p.settings.age18 && !ctx.ageConfirmed) return blocked('age18', p.doc.theme.tokens.systemScreens.age18.text || 'Материал для тех, кому есть 18 лет');
    const media = await this.mediaOf(p.ownerId, p.doc);
    const fontsMap = await this.fontsOf(p.ownerId, p.doc);
    // Добавляем WOFF2 медиафайлы шрифтов в карту media
    for (const [, fontInfo] of Object.entries(fontsMap)) {
      for (const [, mid] of Object.entries(fontInfo.styles)) {
        media[mid] = { kind: 'FONT_SOURCE', mime: 'font/woff2' };
      }
    }
    return {
      state: 'ok',
      projectId: p.id,
      versionId: p.versionId,
      slug: p.slug,
      title: p.doc.meta.title,
      description: p.doc.meta.description,
      ogImageId: p.doc.meta.ogImage?.source === 'media' ? p.doc.meta.ogImage.id : null,
      indexable: false,
      document: toPublicDocument(p.doc),
      media,
      fonts: fontsMap,
      ...marks(p, (await this.entitlements.limitsOfProject(p.ownerId, p.id, now)).plan.limits.watermark),
    };
  }

  /** PL-08, PL-09 · «Войти»: the password and/or the confirmation of age; the answer is the open project with the proof of the password. */
  async enter(slug: string, body: { password?: unknown; age18?: unknown }, ip: string): Promise<PlayView> {
    const p = await this.published({ slug });
    if (p.settings.passwordHash) {
      const key = `${ip}:${p.id}`;
      const t = this.tries.get(key);
      const fresh = t && Date.now() - t.since < PASSWORD_WINDOW_MS ? t : { n: 0, since: Date.now() };
      if (fresh.n >= PASSWORD_TRIES) throw fail(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток. Подождите несколько минут.');
      if (typeof body.password !== 'string' || !(await verifyPassword(body.password, p.settings.passwordHash))) {
        this.tries.set(key, { n: fresh.n + 1, since: fresh.since });
        throw fail(403, 'WRONG_PASSWORD', 'Неверный пароль.');
      }
      this.tries.delete(key);
    }
    const token = p.settings.passwordHash ? unlockToken(this.config.totpSecretKey, p.id, p.settings.passwordHash) : undefined;
    const next = await this.view(slug, { unlock: token, ageConfirmed: body.age18 === true });
    return token ? { ...next, unlock: token } : next;
  }

  /** The file of a published version for participants: only media that the published document refers to. */
  async mediaFile(slug: string, mediaId: string): Promise<{ path: string; mime: string }> {
    const p = await this.published({ slug });
    // Проверяем, что mediaId упоминается в документе либо принадлежит шрифту этого проекта
    const inDoc = JSON.stringify(p.doc).includes(`"${mediaId}"`);
    if (!inDoc) {
      // TH-04: также проверяем, является ли mediaId WOFF2-файлом шрифта владельца
      const fontRows = await this.db
        .select({ styles: schema.fonts.styles })
        .from(schema.fonts)
        .where(and(eq(schema.fonts.ownerId, p.ownerId), isNull(schema.fonts.deletedAt)));
      const fontHasMedia = fontRows.some((row) =>
        Object.values(row.styles as Record<string, { mediaId: string }>).some((s) => s.mediaId === mediaId),
      );
      if (!fontHasMedia) throw unavailable();
    }
    const [m] = await this.db
      .select({ mime: schema.media.mime, status: schema.media.status, variants: schema.media.variants })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, p.ownerId), isNull(schema.media.deletedAt)));
    if (!m || m.status === 'BLOCKED' || m.status === 'REJECTED') throw unavailable();
    return { path: this.storage.getPath(servedKey(p.ownerId, mediaId, m.variants)), mime: m.mime };
  }

  /**
   * TH-04 · собирает карту пользовательских шрифтов документа.
   * Рекурсивно обходит весь документ, ищет FontRef с kind:'font',
   * дедуплицирует, запрашивает таблицу fonts.
   */
  async fontsOf(ownerId: string, doc: ProjectDocument): Promise<PlayOpen['fonts']> {
    const fontIds = new Set<string>();
    // Рекурсивный обход всего дерева — FontRef {kind:'font', id:...} встречается только
    // в theme.tokens.fonts.* и в block.style.text.font, но проще обойти всё сразу.
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o['kind'] === 'font' && typeof o['id'] === 'string') {
          fontIds.add(o['id']);
          return;
        }
        Object.values(o).forEach(walk);
      }
    };
    walk(doc);
    if (fontIds.size === 0) return {};
    const rows = await this.db
      .select({ id: schema.fonts.id, family: schema.fonts.family, styles: schema.fonts.styles })
      .from(schema.fonts)
      .where(and(eq(schema.fonts.ownerId, ownerId), inArray(schema.fonts.id, [...fontIds]), isNull(schema.fonts.deletedAt)));
    return Object.fromEntries(
      rows.map((row) => {
        const styles = row.styles as Record<string, { mediaId: string }>;
        return [
          row.id,
          {
            family: `bk-font-${row.id}`,
            styles: Object.fromEntries(Object.entries(styles).map(([key, val]) => [key, val.mediaId])),
          },
        ];
      }),
    );
  }

  /** Media the document refers to: owner media (`{source:'media', id}`) and library items (`{source:'library', id}`). */
  private async mediaOf(ownerId: string, doc: ProjectDocument): Promise<PlayOpen['media']> {
    const ownIds = new Set<string>();
    const libIds = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o.source === 'media' && typeof o.id === 'string') ownIds.add(o.id);
        if (o.source === 'library' && typeof o.id === 'string') libIds.add(o.id);
        Object.values(o).forEach(walk);
      }
    };
    walk(doc);

    const result: PlayOpen['media'] = {};

    if (ownIds.size > 0) {
      const rows = await this.db
        .select({ id: schema.media.id, kind: schema.media.kind, mime: schema.media.mime, status: schema.media.status })
        .from(schema.media)
        .where(and(eq(schema.media.ownerId, ownerId), inArray(schema.media.id, [...ownIds]), isNull(schema.media.deletedAt)));
      // TS-24: include all referenced media but tag non-ready files with a stub marker.
      for (const r of rows) {
        const stub: 'processing' | 'blocked' | undefined =
          r.status === 'BLOCKED' || r.status === 'REJECTED' ? 'blocked' :
          r.status === 'UPLOADED' || r.status === 'PROCESSING' ? 'processing' : undefined;
        result[r.id] = stub ? { kind: r.kind, mime: r.mime, stub } : { kind: r.kind, mime: r.mime };
      }
    }

    // LB-04: library items — withdrawn items become stubs.
    if (libIds.size > 0) {
      const libRows = await this.db
        .select({ id: schema.libraryItems.id, active: schema.libraryItems.active, mediaId: schema.libraryItems.mediaId, mime: schema.media.mime, kind: schema.media.kind })
        .from(schema.libraryItems)
        .leftJoin(schema.media, eq(schema.media.id, schema.libraryItems.mediaId))
        .where(inArray(schema.libraryItems.id, [...libIds]));
      for (const r of libRows) {
        if (!r.active) {
          result[r.id] = { kind: 'IMAGE', mime: 'image/png', stub: 'blocked' };
        } else if (r.mime && r.kind) {
          result[r.id] = { kind: r.kind, mime: r.mime };
        }
      }
    }

    return result;
  }

  /**
   * PL-02 · a scan of the QR code: counted for the access point, and the way to the current address of the project
   * (the code stays the same when the slug changes).
   */
  async scan(code: string, now = new Date()): Promise<{ slug: string; source: string }> {
    const [ap] = await this.db
      .select({ id: schema.accessPoints.id, projectId: schema.accessPoints.projectId, active: schema.accessPoints.active, slug: schema.projects.slug })
      .from(schema.accessPoints)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.accessPoints.projectId))
      .where(and(eq(schema.accessPoints.code, code), isNull(schema.projects.deletedAt)));
    if (!ap || !ap.active) throw unavailable();
    const day = now.toISOString().slice(0, 10);
    for (const accessPointId of [ap.id, '']) {
      await this.db
        .insert(schema.projectStatsDaily)
        .values({ projectId: ap.projectId, day, accessPointId, opens: 1 })
        .onConflictDoUpdate({ target: [schema.projectStatsDaily.projectId, schema.projectStatsDaily.day, schema.projectStatsDaily.accessPointId], set: { opens: sql`${schema.projectStatsDaily.opens} + 1` } });
    }
    return { slug: ap.slug, source: code };
  }

  /**
   * PL-06…PL-11 · the start of a passage: the checks of §10.3 in their order, then the admission under a lock so that a
   * flood of starts never goes over a limit (the project's own limits and the monthly limit of the tariff).
   */
  async start(projectId: string, body: { deviceToken?: unknown; source?: unknown; unlock?: unknown; age18?: unknown }, userAgent: string | undefined, ip: string, now = new Date()): Promise<{ sessionId: string; versionId: string }> {
    const p = await this.published({ projectId });
    // TS-13: starts are limited by the hash of the address (rotating every day; the address itself is not kept).
    const ipHash = hashIp(ip, now, 64);
    const [recent] = await this.db.select({ n: count() }).from(schema.participantSessions).where(and(eq(schema.participantSessions.ipHash, ipHash), gte(schema.participantSessions.startedAt, new Date(now.getTime() - 3_600_000))));
    if ((recent?.n ?? 0) >= (this.config.playLimits?.startsPerHourPerIp ?? 120)) throw fail(429, 'TOO_MANY_REQUESTS', 'Слишком много запусков с вашего адреса. Попробуйте позже.');
    const closed = await this.closedReason(p, now);
    if (closed) throw fail(403, closed.state === 'not_open' ? 'NOT_OPEN' : 'CLOSED', closed.text);
    if (!this.unlocked(p, typeof body.unlock === 'string' ? body.unlock : undefined)) throw fail(403, 'PASSWORD_REQUIRED', 'Нужен пароль.');
    if (p.settings.age18 && body.age18 !== true) throw fail(403, 'AGE_REQUIRED', 'Нужно подтвердить возраст.');
    const device = typeof body.deviceToken === 'string' && body.deviceToken.length >= 8 && body.deviceToken.length <= 100 ? deviceHash(p.id, body.deviceToken) : null;
    if (p.settings.singleAttempt && !device) throw fail(400, 'DEVICE_TOKEN_REQUIRED', 'Не удалось определить устройство.');

    // The tariff is read before the transaction opens: inside it a second connection would be taken from the pool while this one waits.
    const { plan, pass } = await this.entitlements.limitsOfProject(p.ownerId, p.id, now);
    let usage: UsageNotice | null = null;
    const started = await this.db.transaction(async (tx) => {
      // Locks are always taken in the same order (account, then project), so two projects of one account cannot block each other.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'owner:' + p.ownerId}))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'project:' + p.id}))`);

      const [counter] = await tx.select({ starts: sql<number>`coalesce(max(${schema.limitCounters.value}) filter (where ${schema.limitCounters.kind} = 'STARTS'), 0)`, completions: sql<number>`coalesce(max(${schema.limitCounters.value}) filter (where ${schema.limitCounters.kind} = 'COMPLETIONS'), 0)` }).from(schema.limitCounters).where(eq(schema.limitCounters.projectId, p.id));
      const starts = Number(counter?.starts ?? 0);
      const completions = Number(counter?.completions ?? 0);
      // 3. Limit of the creator (PL-06): started and/or completed. A passage in progress will probably complete, so it holds a place.
      if (p.settings.maxStarts && starts >= p.settings.maxStarts) throw fail(403, 'CLOSED', p.settings.closedText?.trim() || 'Сборка закрыта');
      if (p.settings.maxCompletions) {
        const [active] = await tx
          .select({ n: count() })
          .from(schema.participantSessions)
          .where(and(eq(schema.participantSessions.projectId, p.id), eq(schema.participantSessions.status, 'IN_PROGRESS'), eq(schema.participantSessions.isPreview, false), gt(schema.participantSessions.lastActivityAt, new Date(now.getTime() - ACTIVE_WINDOW_MS))));
        if (completions + (active?.n ?? 0) >= p.settings.maxCompletions) throw fail(403, 'CLOSED', p.settings.closedText?.trim() || 'Сборка закрыта');
      }
      // 4. Limit of the tariff (PL-07): new passages do not start; those already begun go on. The tariff of the account counts
      // passages of the month for the whole account; the pass «Праздник» counts passages of its project for the term of the pass.
      const scoped = plan.limits.completionsScope === 'project' && pass !== null;
      const [month] = scoped
        ? await tx
            .select({ n: count() })
            .from(schema.participantSessions)
            .where(and(eq(schema.participantSessions.projectId, p.id), eq(schema.participantSessions.isPreview, false), gte(schema.participantSessions.startedAt, pass.from)))
        : await tx
            .select({ n: count() })
            .from(schema.participantSessions)
            .innerJoin(schema.projects, eq(schema.projects.id, schema.participantSessions.projectId))
            .where(and(eq(schema.projects.ownerId, p.ownerId), eq(schema.participantSessions.isPreview, false), gte(schema.participantSessions.startedAt, monthStart(now))));
      if ((month?.n ?? 0) >= plan.limits.completionsPerMonth) {
        // P7.5: passages bought extra are spent only after the limit of the tariff; one unit goes with each start.
        const spent = await tx.execute(sql`
          update entitlements set quantity = quantity - 1
          where id = (
            select id from entitlements
            where feature = 'EXTRA_COMPLETIONS' and quantity > 0 and valid_from <= ${now} and (valid_to is null or valid_to > ${now})
              and ${scoped ? sql`project_id = ${p.id}` : sql`user_id = ${p.ownerId} and project_id is null`}
            order by valid_to asc nulls last limit 1 for update)
          returning id`);
        if (spent.rows.length === 0) throw fail(503, 'TEMPORARILY_UNAVAILABLE', 'Временно недоступно');
      }
      // P7.2: the start that takes the tariff to 80 % and the one that takes it to the limit — each happens once in a period, because
      // the count is read under the lock of the account.
      usage = usageNotice((month?.n ?? 0) + 1, plan.limits.completionsPerMonth, scoped ? p.title : null);
      // 7. One attempt from a device (PL-10): a token kept by the browser, never a fingerprint.
      if (p.settings.singleAttempt && device) {
        const [again] = await tx
          .select({ id: schema.participantSessions.id })
          .from(schema.participantSessions)
          .where(and(eq(schema.participantSessions.projectId, p.id), eq(schema.participantSessions.deviceTokenHash, device), ne(schema.participantSessions.status, 'REJECTED'), eq(schema.participantSessions.isPreview, false)))
          .limit(1);
        if (again) throw fail(409, 'ALREADY_PLAYED', 'Вы уже проходили эту сборку.');
      }
      let accessPointId: string | null = null;
      if (typeof body.source === 'string') {
        const [ap] = await tx.select({ id: schema.accessPoints.id }).from(schema.accessPoints).where(and(eq(schema.accessPoints.code, body.source), eq(schema.accessPoints.projectId, p.id)));
        accessPointId = ap?.id ?? null;
      }
      const sessionId = createId();
      await tx.insert(schema.participantSessions).values({ id: sessionId, projectId: p.id, versionId: p.versionId, accessPointId, deviceTokenHash: device, ipHash, deviceType: deviceTypeOf(userAgent), startedAt: now, lastActivityAt: now });
      await tx
        .insert(schema.limitCounters)
        .values({ projectId: p.id, kind: 'STARTS', value: 1 })
        .onConflictDoUpdate({ target: [schema.limitCounters.projectId, schema.limitCounters.kind], set: { value: sql`${schema.limitCounters.value} + 1` } });
      return { sessionId, versionId: p.versionId };
    });
    // The message is a courtesy to the creator: its failure must not undo the passage that has begun.
    const notice = usage as UsageNotice | null;
    if (notice && this.notifications) await this.notifications.notify({ userId: p.ownerId, kind: notice.kind, title: notice.title, body: notice.body, projectId: p.id }).catch(() => undefined);
    return started;
  }
}
