import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { COPYRIGHT_CLAIM_HOURS, DATA_REQUEST_EXTENSION_DAYS, DEADLINE_ALERT_HOURS, addWorkingDays } from '@blokum/schema';
import { AuditLogService } from '../auth/audit-log.service.js';
import { type RequestUser } from '../auth/session.service.js';
import { DB } from '../tokens.js';
import { fail } from './errors.js';
import { ModerationService } from './moderation.service.js';
import { NotificationsService } from './notifications.service.js';

const HOUR_MS = 3_600_000;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const need = (value: string, min: number, max: number, what: string): string => {
  if (value.length < min || value.length > max) throw fail(422, 'FIELD', `${what}: от ${min} до ${max} знаков.`);
  return value;
};

/** AD-04 · registers of the notices of copyright holders and of the requests of state bodies, with the countdown (docs/06-TRUST-SAFETY.md §4.3, §6). */
@Injectable()
export class LegalLogsService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogService,
    private readonly moderation: ModerationService,
    private readonly notices: NotificationsService,
  ) {}

  /** The alerts go out by themselves: the terms are looked at every five minutes while the API runs (not under tests — they call the check directly). */
  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    this.timer = setInterval(() => void this.sendDeadlineAlerts().catch(() => undefined), 5 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Copyright holders' notices (149-ФЗ ст. 15.7) ───────────────────────────

  async claims(now = new Date()) {
    const rows = await this.db.select().from(schema.copyrightClaims).orderBy(asc(schema.copyrightClaims.status), asc(schema.copyrightClaims.dueAt)).limit(200);
    const strikes = await this.db
      .select({ projectId: schema.copyrightClaims.projectId, n: count() })
      .from(schema.copyrightClaims)
      .where(eq(schema.copyrightClaims.status, 'REMOVED'))
      .groupBy(schema.copyrightClaims.projectId);
    return rows.map(({ ipHash: _ipHash, ...c }) => ({
      ...c,
      open: c.status === 'NEW' || c.status === 'CLARIFY_REQUESTED',
      remainingMs: c.dueAt.getTime() - now.getTime(),
      overdue: (c.status === 'NEW' || c.status === 'CLARIFY_REQUESTED') && c.dueAt.getTime() < now.getTime(),
      strikes: c.projectId ? (strikes.find((s) => s.projectId === c.projectId)?.n ?? 0) : 0,
    }));
  }

  async registerClaim(actor: RequestUser, body: Record<string, unknown>, ip?: string, now = new Date()) {
    const claimant = need(text(body.claimant), 3, 300, 'Кто обращается');
    const description = need(text(body.objectDescription), 5, 4000, 'Что защищается');
    const urls = (Array.isArray(body.urls) ? body.urls : []).map(text).filter((u) => u !== '');
    if (urls.length === 0) throw fail(422, 'FIELD', 'Укажите хотя бы одну ссылку на спорный материал.');
    const statement = need(text(body.statement), 5, 4000, 'Заявление');
    const projectId = text(body.projectId) || null;
    if (projectId) {
      const [p] = await this.db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId));
      if (!p) throw fail(404, 'NOT_FOUND', 'Сборка не найдена');
    }
    const [row] = await this.db
      .insert(schema.copyrightClaims)
      .values({ projectId, claimant: { name: claimant }, objectDescription: description, urls, statement: { text: statement }, receivedAt: now, dueAt: new Date(now.getTime() + COPYRIGHT_CLAIM_HOURS * HOUR_MS) })
      .returning({ id: schema.copyrightClaims.id });
    await this.audit.log({ actorId: actor.id, action: 'COPYRIGHT_CLAIM_REGISTERED', targetType: 'COPYRIGHT_CLAIM', targetId: row!.id, ...(ip ? { ip } : {}) });
    return { id: row!.id };
  }

  /** §4.3: the moderator may ask the holder to clarify — once. */
  async clarify(actor: RequestUser, id: string, ip?: string, now = new Date()): Promise<void> {
    const [c] = await this.db.select().from(schema.copyrightClaims).where(eq(schema.copyrightClaims.id, id));
    if (!c) throw fail(404, 'NOT_FOUND', 'Заявление не найдено');
    if (c.status !== 'NEW' || c.clarifyRequestedAt) throw fail(409, 'CLARIFY_ONCE', 'Уточнение можно запросить один раз, пока заявление новое.');
    await this.db.update(schema.copyrightClaims).set({ status: 'CLARIFY_REQUESTED', clarifyRequestedAt: now }).where(eq(schema.copyrightClaims.id, id));
    await this.audit.log({ actorId: actor.id, action: 'COPYRIGHT_CLAIM_CLARIFY', targetType: 'COPYRIGHT_CLAIM', targetId: id, ...(ip ? { ip } : {}) });
  }

  /** Removes the material (a decision on the project or file) or answers with the proof that the use is lawful. */
  async resolveClaim(actor: RequestUser, id: string, body: Record<string, unknown>, ip?: string, now = new Date()): Promise<void> {
    const outcome = text(body.outcome);
    const note = need(text(body.note), 3, 2000, 'Комментарий');
    if (outcome !== 'REMOVED' && outcome !== 'REJECTED_WITH_PROOF') throw fail(422, 'OUTCOME', 'Выберите: снять материал или ответить с доказательствами.');
    const [c] = await this.db.select().from(schema.copyrightClaims).where(eq(schema.copyrightClaims.id, id));
    if (!c) throw fail(404, 'NOT_FOUND', 'Заявление не найдено');
    if (c.status === 'REMOVED' || c.status === 'REJECTED_WITH_PROOF') throw fail(409, 'CLOSED', 'Заявление уже закрыто.');
    if (outcome === 'REMOVED') {
      const mediaId = text(body.mediaId);
      if (mediaId) await this.moderation.act(actor, { targetType: 'MEDIA', targetId: mediaId, action: 'BLOCK_MEDIA', reasonCode: 'B6', note });
      else if (c.projectId) await this.moderation.act(actor, { targetType: 'PROJECT', targetId: c.projectId, action: 'UNPUBLISH', reasonCode: 'B6', note });
      else throw fail(422, 'TARGET', 'Укажите сборку или файл, который снимается.');
    }
    await this.db.update(schema.copyrightClaims).set({ status: outcome, resolvedAt: now, resolution: note }).where(eq(schema.copyrightClaims.id, id));
    await this.audit.log({ actorId: actor.id, action: outcome === 'REMOVED' ? 'COPYRIGHT_CLAIM_REMOVED' : 'COPYRIGHT_CLAIM_REJECTED', targetType: 'COPYRIGHT_CLAIM', targetId: id, ...(ip ? { ip } : {}) });
  }

  // ── Requests of state bodies ───────────────────────────────────────────────

  async authority(now = new Date()) {
    const rows = await this.db.select().from(schema.authorityRequests).orderBy(asc(schema.authorityRequests.status), asc(schema.authorityRequests.dueAt)).limit(200);
    return rows.map((r) => ({ ...r, remainingMs: r.dueAt.getTime() - now.getTime(), overdue: r.status !== 'CLOSED' && r.dueAt.getTime() < now.getTime() }));
  }

  async registerAuthority(actor: RequestUser, body: Record<string, unknown>, ip?: string) {
    const source = need(text(body.source), 2, 200, 'Кто обратился');
    const number = need(text(body.number), 1, 100, 'Номер требования');
    const subject = need(text(body.subject), 3, 4000, 'Суть требования');
    const receivedAt = new Date(text(body.receivedAt));
    const dueAt = new Date(text(body.dueAt));
    if (Number.isNaN(receivedAt.getTime()) || Number.isNaN(dueAt.getTime())) throw fail(422, 'DATE', 'Укажите даты получения и срока.');
    if (dueAt.getTime() <= receivedAt.getTime()) throw fail(422, 'DATE', 'Срок должен быть позже даты получения.');
    const [row] = await this.db.insert(schema.authorityRequests).values({ source, number, subject, receivedAt, dueAt }).returning({ id: schema.authorityRequests.id });
    await this.audit.log({ actorId: actor.id, action: 'AUTHORITY_REQUEST_REGISTERED', targetType: 'AUTHORITY_REQUEST', targetId: row!.id, ...(ip ? { ip } : {}) });
    return { id: row!.id };
  }

  async addAuthorityAction(actor: RequestUser, id: string, actionRaw: unknown, ip?: string, now = new Date()): Promise<void> {
    const action = need(text(actionRaw), 3, 1000, 'Что сделано');
    const [r] = await this.db.select().from(schema.authorityRequests).where(eq(schema.authorityRequests.id, id));
    if (!r) throw fail(404, 'NOT_FOUND', 'Требование не найдено');
    if (r.status === 'CLOSED') throw fail(409, 'CLOSED', 'Требование уже закрыто.');
    await this.db
      .update(schema.authorityRequests)
      .set({ actions: [...r.actions, { at: now.toISOString(), action }], status: 'IN_PROGRESS' })
      .where(eq(schema.authorityRequests.id, id));
    await this.audit.log({ actorId: actor.id, action: 'AUTHORITY_REQUEST_ACTION', targetType: 'AUTHORITY_REQUEST', targetId: id, ...(ip ? { ip } : {}) });
  }

  async closeAuthority(actor: RequestUser, id: string, ip?: string, now = new Date()): Promise<void> {
    const [r] = await this.db.select().from(schema.authorityRequests).where(eq(schema.authorityRequests.id, id));
    if (!r) throw fail(404, 'NOT_FOUND', 'Требование не найдено');
    if (r.actions.length === 0) throw fail(409, 'NO_ACTIONS', 'Сначала запишите, что сделано.');
    await this.db.update(schema.authorityRequests).set({ status: 'CLOSED', closedAt: now }).where(and(eq(schema.authorityRequests.id, id), inArray(schema.authorityRequests.status, ['NEW', 'IN_PROGRESS'])));
    await this.audit.log({ actorId: actor.id, action: 'AUTHORITY_REQUEST_CLOSED', targetType: 'AUTHORITY_REQUEST', targetId: id, ...(ip ? { ip } : {}) });
  }

  // ── Requests of people about their data (152-ФЗ ст. 14, 20) ─────────────────

  async dataRequests(now = new Date()) {
    const rows = await this.db.select().from(schema.dataSubjectRequests).orderBy(asc(schema.dataSubjectRequests.status), asc(schema.dataSubjectRequests.dueAt)).limit(200);
    return rows.map(({ ipHash: _ipHash, ...r }) => ({ ...r, remainingMs: r.dueAt.getTime() - now.getTime(), overdue: r.status !== 'CLOSED' && r.dueAt.getTime() < now.getTime() }));
  }

  /** Ст. 20: the term may be moved once, by five working days, and the reason is written down — it goes into the answer to the person. */
  async extendDataRequest(actor: RequestUser, id: string, reasonRaw: unknown, ip?: string, now = new Date()): Promise<void> {
    const reason = need(text(reasonRaw), 5, 1000, 'Причина продления');
    const [r] = await this.db.select().from(schema.dataSubjectRequests).where(eq(schema.dataSubjectRequests.id, id));
    if (!r) throw fail(404, 'NOT_FOUND', 'Запрос не найден');
    if (r.status === 'CLOSED') throw fail(409, 'CLOSED', 'Запрос уже закрыт.');
    if (r.extendedAt) throw fail(409, 'EXTENDED_ONCE', 'Срок можно продлить один раз.');
    await this.db
      .update(schema.dataSubjectRequests)
      .set({ dueAt: addWorkingDays(r.dueAt, DATA_REQUEST_EXTENSION_DAYS), extendedAt: now, extensionReason: reason, status: 'IN_PROGRESS' })
      .where(eq(schema.dataSubjectRequests.id, id));
    await this.audit.log({ actorId: actor.id, action: 'DATA_REQUEST_EXTENDED', targetType: 'DATA_REQUEST', targetId: id, ...(ip ? { ip } : {}) });
  }

  async closeDataRequest(actor: RequestUser, id: string, resolutionRaw: unknown, ip?: string, now = new Date()): Promise<void> {
    const resolution = need(text(resolutionRaw), 5, 4000, 'Что отвечено');
    const [r] = await this.db.select().from(schema.dataSubjectRequests).where(eq(schema.dataSubjectRequests.id, id));
    if (!r) throw fail(404, 'NOT_FOUND', 'Запрос не найден');
    if (r.status === 'CLOSED') throw fail(409, 'CLOSED', 'Запрос уже закрыт.');
    await this.db.update(schema.dataSubjectRequests).set({ status: 'CLOSED', closedAt: now, resolution }).where(eq(schema.dataSubjectRequests.id, id));
    await this.audit.log({ actorId: actor.id, action: 'DATA_REQUEST_CLOSED', targetType: 'DATA_REQUEST', targetId: id, ...(ip ? { ip } : {}) });
  }

  // ── Alerts before a term runs out (05-LEGAL.md §7) ─────────────────────────

  /**
   * Six hours and one hour before the term of an open notice or request, every moderator and administrator gets a message
   * (and a letter, when the address is confirmed). Each alert is sent once: its kind names the case and the hour mark.
   */
  async sendDeadlineAlerts(now = new Date()): Promise<string[]> {
    const open: Array<{ key: string; what: string; dueAt: Date }> = [];
    for (const c of await this.claims(now)) if (c.open) open.push({ key: `claim:${c.id}`, what: `заявление правообладателя (${text(c.claimant.name) || 'без имени'})`, dueAt: c.dueAt });
    for (const r of await this.authority(now)) if (r.status !== 'CLOSED') open.push({ key: `authority:${r.id}`, what: `требование «${r.source}» № ${r.number}`, dueAt: r.dueAt });
    for (const r of await this.dataRequests(now)) if (r.status !== 'CLOSED') open.push({ key: `data:${r.id}`, what: 'запрос человека о его данных', dueAt: r.dueAt });
    const sent: string[] = [];
    let staff: Array<{ id: string }> | null = null;
    for (const item of open) {
      const left = item.dueAt.getTime() - now.getTime();
      // The nearest mark that has been passed: at 40 minutes left it is the one-hour alert, not both.
      const mark = [...DEADLINE_ALERT_HOURS].sort((a, b) => a - b).find((h) => left <= h * HOUR_MS);
      if (mark === undefined || left <= 0) continue;
      const kind = `deadline-${mark}h:${item.key}`;
      const [done] = await this.db.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.kind, kind)).limit(1);
      if (done) continue;
      staff ??= await this.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.role, ['MODERATOR', 'ADMIN']));
      for (const u of staff) {
        await this.notices
          .notify({ userId: u.id, kind, title: `Срок истекает: меньше ${mark} ч`, body: `До конца срока осталось меньше ${mark} ч: ${item.what}. Откройте «Юридические журналы» в админке и примите решение.` })
          .catch(() => undefined);
      }
      sent.push(kind);
    }
    return sent;
  }

  /** The number of unclosed notices and requests that are late (for the front page of the admin). */
  async overdueCount(now = new Date()): Promise<number> {
    const claims = (await this.claims(now)).filter((c) => c.overdue).length;
    const authority = (await this.authority(now)).filter((r) => r.overdue).length;
    const data = (await this.dataRequests(now)).filter((r) => r.overdue).length;
    return claims + authority + data;
  }
}
