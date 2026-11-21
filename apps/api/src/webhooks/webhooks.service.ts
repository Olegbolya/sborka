import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { and, asc, desc, eq, lt, lte } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { fail } from '../admin/errors.js';
import { NotificationsService } from '../admin/notifications.service.js';
import { type ApiConfig } from '../config.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { ResponsesService } from '../projects/responses.service.js';
import { API_CONFIG, DB, WEBHOOK_SENDER } from '../tokens.js';
import { WebhookAddressError, type WebhookSender, createSender, parseWebhookUrl, resolvePublic } from './net.js';

/** Pauses after the 1st, 2nd… failed attempt; after the last attempt the delivery is FAILED (ADR-129). */
export const RETRY_PAUSES_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000] as const;
export const MAX_ATTEMPTS = RETRY_PAUSES_MS.length + 1;
/** The payload holds answers and contacts of participants: the record of a delivery is kept a week, then removed. */
const KEEP_MS = 7 * 86_400_000;
const FAIL_NOTICE_EVERY_MS = 86_400_000;
const DUE_BATCH = 50;

export type WebhookEvent = 'passage.completed' | 'ping';

export interface WebhookDeliveryView {
  id: string;
  event: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  lastResult: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  nextAttemptAt: Date | null;
}

export interface WebhookView {
  /** The plan of the owner has webhooks («Про»). */
  allowed: boolean;
  planTitle: string;
  webhook: { url: string; secret: string; enabled: boolean } | null;
  deliveries: WebhookDeliveryView[];
}

/** The signature of a request: hex HMAC-SHA256 of «<timestamp>.<body>» with the secret of the project (header `X-Blokker-Signature: sha256=…`). */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * D-07 · the webhook of a project («Про»): every finished passage goes to the creator's own system as JSON signed with the secret
 * of the project. A failed delivery is tried again (1 мин, 5 мин, 30 мин, 2 ч, 6 ч); when the attempts end, the creator gets a
 * message in the cabinet (one a day at most). The participant never waits for it: the passage ends first, the webhook is sent after.
 */
@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly send: WebhookSender;
  private readonly allowPrivate: boolean;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly entitlements: EntitlementsService,
    private readonly responses: ResponsesService,
    @Optional() private readonly notices?: NotificationsService,
    @Optional() @Inject(WEBHOOK_SENDER) sender?: WebhookSender,
  ) {
    this.allowPrivate = config.webhookAllowPrivate === true;
    this.send = sender ?? createSender(this.allowPrivate);
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    this.timer = setInterval(() => void this.flush().catch(() => undefined), 30_000);
    this.timer.unref();
  }

  /** Work started in the background (the delivery after a passage): waited for on shutdown, so it never runs against a closed database. */
  private readonly inflight = new Set<Promise<unknown>>();

  private track<T>(work: Promise<T>): Promise<T> {
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work)).catch(() => undefined);
    return work;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.inflight]);
  }

  // ── The secret is stored encrypted with a key derived from the server key (not the same key as for TOTP). ──
  private key(): Buffer {
    return createHash('sha256').update(`webhook:${this.config.totpSecretKey}`).digest();
  }

  private encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}.${ct.toString('hex')}.${cipher.getAuthTag().toString('hex')}`;
  }

  private decrypt(stored: string): string {
    const [iv, ct, tag] = stored.split('.');
    if (!iv || !ct || !tag) throw new Error('Неверный формат секрета вебхука');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(Buffer.from(ct, 'hex')).toString('utf8') + decipher.final('utf8');
  }

  private static newSecret(): string {
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }

  // ── The creator's side ──

  private async ownerOf(userId: string, projectId: string): Promise<{ title: string }> {
    const [p] = await this.db.select({ ownerId: schema.projects.ownerId, title: schema.projects.title, deletedAt: schema.projects.deletedAt }).from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!p || p.ownerId !== userId || p.deletedAt) throw fail(404, 'NOT_FOUND', 'Сборка не найдена');
    return { title: p.title };
  }

  /** 04-TARIFFS §2: «вебхуки» — only the plan with `notifications: instant_plus` («Про»). */
  private async planAllows(ownerId: string, projectId: string): Promise<{ allowed: boolean; planTitle: string }> {
    const { plan } = await this.entitlements.limitsOfProject(ownerId, projectId);
    return { allowed: plan.limits.notifications === 'instant_plus', planTitle: plan.title };
  }

  async view(userId: string, projectId: string): Promise<WebhookView> {
    await this.ownerOf(userId, projectId);
    const { allowed, planTitle } = await this.planAllows(userId, projectId);
    const [row] = await this.db.select().from(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, projectId));
    const deliveries = await this.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.projectId, projectId))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(10);
    return {
      allowed,
      planTitle,
      webhook: row ? { url: row.url, secret: this.decrypt(row.secretEnc), enabled: row.enabled } : null,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status as WebhookDeliveryView['status'],
        attempts: d.attempts,
        lastResult: d.lastResult,
        createdAt: d.createdAt,
        lastAttemptAt: d.lastAttemptAt,
        deliveredAt: d.deliveredAt,
        nextAttemptAt: d.status === 'PENDING' ? d.nextAttemptAt : null,
      })),
    };
  }

  private async requirePlan(userId: string, projectId: string): Promise<void> {
    const { allowed, planTitle } = await this.planAllows(userId, projectId);
    if (!allowed) throw fail(402, 'PLAN_LIMIT', `Вебхук недоступен на тарифе «${planTitle}». Он есть на тарифе «Про».`);
  }

  /** Save the address (a new webhook gets its secret here) and on/off. The address is checked: https and a public server. */
  async save(userId: string, projectId: string, body: { url?: unknown; enabled?: unknown }): Promise<WebhookView> {
    await this.ownerOf(userId, projectId);
    await this.requirePlan(userId, projectId);
    let url: URL;
    try {
      url = parseWebhookUrl(body.url, this.allowPrivate);
      await resolvePublic(url.hostname, this.allowPrivate);
    } catch (e) {
      if (e instanceof WebhookAddressError) throw fail(422, 'INVALID_WEBHOOK_URL', e.message);
      throw e;
    }
    const enabled = body.enabled === undefined ? true : body.enabled === true;
    await this.db
      .insert(schema.projectWebhooks)
      .values({ projectId, url: url.toString(), secretEnc: this.encrypt(WebhooksService.newSecret()), enabled })
      .onConflictDoUpdate({ target: schema.projectWebhooks.projectId, set: { url: url.toString(), enabled, updatedAt: new Date() } });
    return this.view(userId, projectId);
  }

  /** A new secret: the old one stops working at once (the creator puts the new one into their system). */
  async rotateSecret(userId: string, projectId: string): Promise<WebhookView> {
    await this.ownerOf(userId, projectId);
    await this.requirePlan(userId, projectId);
    const rows = await this.db
      .update(schema.projectWebhooks)
      .set({ secretEnc: this.encrypt(WebhooksService.newSecret()), updatedAt: new Date() })
      .where(eq(schema.projectWebhooks.projectId, projectId))
      .returning({ id: schema.projectWebhooks.projectId });
    if (rows.length === 0) throw fail(404, 'NOT_FOUND', 'Вебхук ещё не настроен');
    return this.view(userId, projectId);
  }

  /** Remove the webhook: what waits is not sent (its records stay for the week, marked FAILED). */
  async remove(userId: string, projectId: string): Promise<void> {
    await this.ownerOf(userId, projectId);
    await this.db.delete(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, projectId));
    await this.db
      .update(schema.webhookDeliveries)
      .set({ status: 'FAILED', lastResult: 'вебхук удалён' })
      .where(and(eq(schema.webhookDeliveries.projectId, projectId), eq(schema.webhookDeliveries.status, 'PENDING')));
  }

  /** «Отправить проверку»: one `ping` now, without repeats; the answer says how it went. */
  async test(userId: string, projectId: string): Promise<WebhookDeliveryView> {
    const { title } = await this.ownerOf(userId, projectId);
    await this.requirePlan(userId, projectId);
    const [hook] = await this.db.select({ id: schema.projectWebhooks.projectId }).from(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, projectId));
    if (!hook) throw fail(404, 'NOT_FOUND', 'Сначала сохраните адрес вебхука');
    const id = await this.insert(projectId, 'ping', { project: { id: projectId, title }, message: 'Проверка вебхука Блоккера' });
    await this.attempt(id, new Date(), true);
    const view = await this.view(userId, projectId);
    return view.deliveries.find((d) => d.id === id)!;
  }

  /** «Отправить ещё раз» for a delivery that has failed: the attempts start over. */
  async retry(userId: string, projectId: string, deliveryId: string): Promise<WebhookDeliveryView> {
    await this.ownerOf(userId, projectId);
    await this.requirePlan(userId, projectId);
    const rows = await this.db
      .update(schema.webhookDeliveries)
      .set({ status: 'PENDING', attempts: 0, nextAttemptAt: new Date() })
      .where(and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.projectId, projectId), eq(schema.webhookDeliveries.status, 'FAILED')))
      .returning({ id: schema.webhookDeliveries.id, event: schema.webhookDeliveries.event });
    if (rows.length === 0) throw fail(404, 'NOT_FOUND', 'Такой неудачной отправки нет');
    await this.attempt(deliveryId, new Date(), rows[0]!.event === 'ping');
    const view = await this.view(userId, projectId);
    return view.deliveries.find((d) => d.id === deliveryId)!;
  }

  // ── Events ──

  private async insert(projectId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<string> {
    const [row] = await this.db
      .insert(schema.webhookDeliveries)
      // The time of the first attempt is the clock of this process, not of the database: the attempt that follows compares with
      // `new Date()`, and the database clock (microseconds) may be a hair ahead.
      .values({ projectId, event, payload: data, nextAttemptAt: new Date() })
      .returning({ id: schema.webhookDeliveries.id });
    return row!.id;
  }

  /**
   * A finished passage of a project with a webhook: the record is made now, the first attempt goes at once in the background (the
   * participant does not wait for the creator's server). Nothing happens without a webhook, when it is off, or below «Про».
   */
  passageCompleted(ownerId: string, projectId: string, sessionId: string): Promise<string | null> {
    return this.track(this.queuePassage(ownerId, projectId, sessionId));
  }

  private async queuePassage(ownerId: string, projectId: string, sessionId: string): Promise<string | null> {
    const [hook] = await this.db.select({ enabled: schema.projectWebhooks.enabled }).from(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, projectId));
    if (!hook?.enabled) return null;
    if (!(await this.planAllows(ownerId, projectId)).allowed) return null;
    const [project] = await this.db.select({ title: schema.projects.title, slug: schema.projects.slug }).from(schema.projects).where(eq(schema.projects.id, projectId));
    const r = await this.responses.getResponse(ownerId, sessionId);
    const payload = {
      project: { id: projectId, title: project?.title ?? '', link: `${this.config.webUrl}/s/${project?.slug ?? ''}` },
      passage: {
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        durationMs: r.durationMs,
        device: r.deviceType,
        score: r.score,
        result: r.resultKey,
        source: r.source,
        path: r.path,
        answers: r.answers.map((a) => ({ blockId: a.blockId, variableId: a.variableId, question: a.label, text: a.shown, value: a.value, answeredAt: a.answeredAt.toISOString(), countedOnDevice: a.deviceReported })),
      },
    };
    const id = await this.insert(projectId, 'passage.completed', payload);
    void this.track(this.attempt(id, new Date(), false)).catch(() => undefined);
    return id;
  }

  // ── Delivery ──

  /**
   * One attempt of a delivery. The row is claimed first (attempts + 1, the next time pushed forward), so a second process or the
   * next tick of the timer does not send the same thing at the same moment. `once` — a check: no repeats.
   */
  async attempt(deliveryId: string, now: Date, once: boolean): Promise<boolean> {
    const [claimed] = await this.db
      .select()
      .from(schema.webhookDeliveries)
      .where(and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.status, 'PENDING'), lte(schema.webhookDeliveries.nextAttemptAt, now)));
    if (!claimed) return false;
    const pause = RETRY_PAUSES_MS[Math.min(claimed.attempts, RETRY_PAUSES_MS.length - 1)]!;
    const taken = await this.db
      .update(schema.webhookDeliveries)
      .set({ attempts: claimed.attempts + 1, nextAttemptAt: new Date(now.getTime() + pause), lastAttemptAt: now })
      .where(and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.attempts, claimed.attempts), eq(schema.webhookDeliveries.status, 'PENDING')))
      .returning({ attempts: schema.webhookDeliveries.attempts });
    if (taken.length === 0) return false;
    const attempts = taken[0]!.attempts;

    const [hook] = await this.db.select().from(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, claimed.projectId));
    const [project] = await this.db.select({ ownerId: schema.projects.ownerId, title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, claimed.projectId));
    let outcome: { ok: boolean; result: string };
    if (!hook || !project) outcome = { ok: false, result: 'вебхук удалён' };
    else if (!hook.enabled) outcome = { ok: false, result: 'вебхук выключен' };
    else if (!(await this.planAllows(project.ownerId, claimed.projectId)).allowed) outcome = { ok: false, result: 'вебхук недоступен на тарифе' };
    else {
      const timestamp = String(Math.floor(now.getTime() / 1000));
      const body = JSON.stringify({ event: claimed.event, deliveryId: claimed.id, createdAt: claimed.createdAt.toISOString(), ...claimed.payload });
      const secret = this.decrypt(hook.secretEnc);
      outcome = await this.send(new URL(hook.url), {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'Blokker-Webhook/1',
        'x-blokker-event': claimed.event,
        'x-blokker-delivery': claimed.id,
        'x-blokker-timestamp': timestamp,
        'x-blokker-signature': `sha256=${signWebhook(secret, timestamp, body)}`,
      }, body).catch(() => ({ ok: false, result: 'соединение не установлено' }));
    }
    const stop = !outcome.ok && (once || attempts >= MAX_ATTEMPTS || !hook || !hook.enabled || outcome.result === 'вебхук недоступен на тарифе');
    await this.db
      .update(schema.webhookDeliveries)
      .set(outcome.ok ? { status: 'DELIVERED', deliveredAt: new Date(), lastResult: outcome.result } : { status: stop ? 'FAILED' : 'PENDING', lastResult: outcome.result })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    if (stop && !once && hook && project) await this.tellFailed(project.ownerId, claimed.projectId, project.title, hook.failNoticeAt, outcome.result, now);
    return outcome.ok;
  }

  /** The attempts of a passage have ended: the creator is told in the cabinet, one message a day per project. */
  private async tellFailed(ownerId: string, projectId: string, title: string, last: Date | null, result: string, now: Date): Promise<void> {
    if (!this.notices || (last && now.getTime() - last.getTime() < FAIL_NOTICE_EVERY_MS)) return;
    await this.db.update(schema.projectWebhooks).set({ failNoticeAt: now }).where(eq(schema.projectWebhooks.projectId, projectId));
    await this.notices.notify({
      userId: ownerId,
      kind: 'webhook-failed',
      title: `Вебхук сборки «${title.slice(0, 80)}» не принимает данные`,
      body: `Прохождение не удалось передать после ${MAX_ATTEMPTS} попыток примерно за 9 часов. Последний результат: ${result}. Ответы участников сохранены в таблице ответов. Проверьте адрес в «Настройках доступа» → «Вебхук» и нажмите «Отправить ещё раз» у неудачной отправки.`,
      projectId,
      mail: false,
    }).catch(() => undefined);
  }

  /** What is due goes out; records older than a week are removed. `now` is a parameter so tests choose the time. */
  async flush(now: Date = new Date()): Promise<number> {
    await this.db.delete(schema.webhookDeliveries).where(lt(schema.webhookDeliveries.createdAt, new Date(now.getTime() - KEEP_MS)));
    const due = await this.db
      .select({ id: schema.webhookDeliveries.id, event: schema.webhookDeliveries.event })
      .from(schema.webhookDeliveries)
      .where(and(eq(schema.webhookDeliveries.status, 'PENDING'), lte(schema.webhookDeliveries.nextAttemptAt, now)))
      .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
      .limit(DUE_BATCH);
    let delivered = 0;
    for (const d of due) if (await this.attempt(d.id, now, d.event === 'ping')) delivered += 1;
    return delivered;
  }
}
