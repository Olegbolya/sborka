import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB, PAYMENT_PROVIDER } from '../tokens.js';
import { type PaymentProvider, PaymentProviderError } from './payment-provider.js';
import { type OrderKindName, PromoService } from './promo.service.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

export type OrderRequest = { kind?: unknown; planCode?: unknown; period?: unknown; projectId?: unknown; addon?: unknown };
export interface OrderView {
  id: string;
  kind: 'SUBSCRIPTION' | 'PASS' | 'ADDON';
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  amountKop: number;
  item: Record<string, unknown>;
  createdAt: Date;
  paidAt: Date | null;
}

/** The size of extra storage is kept in megabytes: the column is a 32-bit integer. */
const MB = 1024 * 1024;

/** Прибавляет к дате целое число месяцев (по UTC; 31 января + месяц = последний день февраля). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Прибавляет к дате месяц или год. */
export function addPeriod(from: Date, period: 'MONTH' | 'YEAR'): Date {
  return addMonths(from, period === 'MONTH' ? 1 : 12);
}

/**
 * P7.3 · заказы и оплата. Деньги и права двигаются только здесь: заказ создаётся до оплаты, а права (подписка, пропуск)
 * выдаются, когда провайдер подтвердил оплату, ровно один раз — сколько бы раз ни пришло уведомление.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
    private readonly promos: PromoService,
  ) {}

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw fail(503, 'PAYMENTS_UNAVAILABLE', 'Оплата пока не подключена. Попробуйте позже.');
    return this.provider;
  }

  /** What the order costs and what it is, before any discount and without writing anything. */
  private async priceOrder(userId: string, body: OrderRequest): Promise<{ kind: OrderKindName; amountKop: number; item: Record<string, unknown>; description: string }> {
    const kind = body.kind;
    let amountKop: number;
    let item: Record<string, unknown>;
    let description: string;
    if (kind === 'SUBSCRIPTION') {
      const planCode = typeof body.planCode === 'string' ? body.planCode : '';
      const period = body.period === 'YEAR' ? 'YEAR' : body.period === 'MONTH' ? 'MONTH' : null;
      if (!period) throw fail(400, 'ORDER_INVALID', 'Выберите срок: месяц или год.');
      const [plan] = await this.db.select().from(schema.plans).where(and(eq(schema.plans.code, planCode), eq(schema.plans.public, true)));
      const price = period === 'YEAR' ? plan?.priceYearRub : plan?.priceMonthRub;
      if (!plan || !price || price <= 0 || plan.priceOnceRub !== null) throw fail(400, 'ORDER_INVALID', 'Такого тарифа нет.');
      amountKop = price * 100;
      item = { kind, planCode: plan.code, period };
      description = `Блоккер, тариф «${plan.title}» на ${period === 'YEAR' ? 'год' : 'месяц'}`;
    } else if (kind === 'PASS') {
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      const [project] = await this.db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId), isNull(schema.projects.deletedAt)));
      if (!project) throw fail(404, 'PROJECT_NOT_FOUND', 'Сборка не найдена.');
      const [plan] = await this.db.select().from(schema.plans).where(eq(schema.plans.code, 'PASS'));
      if (!plan?.priceOnceRub) throw fail(400, 'ORDER_INVALID', 'Пропуск «Праздник» сейчас не продаётся.');
      amountKop = plan.priceOnceRub * 100;
      item = { kind, planCode: 'PASS', projectId };
      description = 'Блоккер, пропуск «Праздник» на одну сборку';
    } else if (kind === 'ADDON') {
      const addon = await this.addonFor(userId, body.addon, body.projectId);
      amountKop = addon.row.priceRub * 100;
      item = { kind, addon: addon.row.code, ...(addon.projectId ? { projectId: addon.projectId } : {}) };
      description = `Блоккер, ${addon.row.title}`;
    } else {
      throw fail(400, 'ORDER_INVALID', 'Неизвестный вид заказа.');
    }
    return { kind, amountKop, item, description };
  }

  /** P7.5 · the price with a promo code, for the line «К оплате» before the payment; nothing is used up. */
  async quote(userId: string, body: OrderRequest & { promo?: unknown }): Promise<{ listKop: number; discountKop: number; finalKop: number; code: string } | { code: string; kind: string; value: number; appliesTo: string[] }> {
    // Without a purchase named, only the code itself is checked.
    if (body.kind === undefined) return this.promos.describe(userId, body.promo);
    const priced = await this.priceOrder(userId, body);
    const q = await this.promos.quote(userId, body.promo, priced.kind, priced.amountKop);
    return { listKop: q.listKop, discountKop: q.discountKop, finalKop: q.finalKop, code: q.code };
  }

  /** Создаёт заказ «подписка», «пропуск» или допродажа и платёж у провайдера; человек идёт оплачивать по `confirmationUrl`. */
  async createOrder(userId: string, body: OrderRequest & { promo?: unknown }): Promise<{ orderId: string; confirmationUrl: string }> {
    // With a promo code the provider is needed only when something is left to pay (a free pass needs no payment).
    const withPromo = typeof body.promo === 'string' && body.promo.trim() !== '';
    const provider = withPromo ? this.provider : this.requireProvider();
    const priced = await this.priceOrder(userId, body);
    const { kind, description } = priced;
    let { amountKop, item } = priced;
    let redemptionId: string | null = null;
    if (withPromo) {
      const r = await this.promos.reserve(userId, body.promo, kind, amountKop);
      redemptionId = r.redemptionId;
      item = { ...item, promo: r.code, listPriceKop: r.listKop, discountKop: r.discountKop };
      amountKop = r.finalKop;
      if (amountKop > 0 && !provider) {
        await this.promos.release({ redemptionId });
        throw fail(503, 'PAYMENTS_UNAVAILABLE', 'Оплата пока не подключена. Попробуйте позже.');
      }
    }
    const [order] = await this.db
      .insert(schema.orders)
      .values({ userId, kind, item, amountKop, provider: amountKop === 0 ? 'promo' : provider!.name })
      .returning({ id: schema.orders.id })
      .catch(async (e: unknown) => {
        if (redemptionId) await this.promos.release({ redemptionId });
        throw e;
      });
    if (redemptionId) await this.promos.attach(redemptionId, order!.id);
    const returnUrl = kind === 'PASS' ? `${this.config.webUrl}/app/projects/${String(item.projectId)}/edit?paid=${order!.id}` : `${this.config.webUrl}/cabinet/billing?order=${order!.id}`;
    // A free pass by a promo code: nothing to pay, the rights are given at once, the same way as after a payment.
    if (amountKop === 0) {
      await this.markPaid(order!.id);
      return { orderId: order!.id, confirmationUrl: returnUrl };
    }
    try {
      const created = await provider!.createPayment({ orderId: order!.id, amountKop, description, returnUrl });
      await this.db.update(schema.orders).set({ providerPaymentId: created.providerPaymentId }).where(eq(schema.orders.id, order!.id));
      return { orderId: order!.id, confirmationUrl: created.confirmationUrl };
    } catch (e) {
      await this.db.update(schema.orders).set({ status: 'CANCELED' }).where(eq(schema.orders.id, order!.id));
      await this.promos.release({ orderId: order!.id });
      if (e instanceof PaymentProviderError) throw fail(502, 'PAYMENTS_FAILED', 'Платёжный сервис сейчас не отвечает. Попробуйте позже.');
      throw e;
    }
  }

  /** The catalogue of extra purchases with what each can be bought for right now (`reason` tells why not). */
  async addons(userId: string, projectId?: string): Promise<Array<{ code: string; title: string; description: string; priceRub: number; needsProject: boolean; available: boolean; reason: string | null }>> {
    const rows = await this.db.select().from(schema.addons).where(eq(schema.addons.active, true)).orderBy(schema.addons.sort);
    const out = [];
    for (const row of rows) {
      let reason: string | null = null;
      try {
        await this.addonFor(userId, row.code, projectId, rows);
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        reason = (e.getResponse() as { error?: { message?: string } }).error?.message ?? 'Сейчас недоступно.';
      }
      const needsProject = row.params.effect === 'PASS_COMPLETIONS' || row.params.effect === 'PASS_EXTEND';
      out.push({ code: row.code, title: row.title, description: row.description, priceRub: row.priceRub, needsProject, available: reason === null, reason });
    }
    return out;
  }

  /** Checks that the extra purchase fits the person (and the project) and returns it; every refusal says in Russian what to do. */
  private async addonFor(userId: string, code: unknown, projectId: unknown, known?: Array<typeof schema.addons.$inferSelect>): Promise<{ row: typeof schema.addons.$inferSelect; projectId: string | null }> {
    const [row] = known ? known.filter((a) => a.code === code) : await this.db.select().from(schema.addons).where(and(eq(schema.addons.code, typeof code === 'string' ? code : ''), eq(schema.addons.active, true)));
    if (!row) throw fail(400, 'ORDER_INVALID', 'Такой покупки нет.');
    const now = new Date();
    const effect = row.params.effect;
    if (effect === 'PASS_COMPLETIONS' || effect === 'PASS_EXTEND') {
      const id = typeof projectId === 'string' ? projectId : '';
      if (!id) throw fail(400, 'ADDON_NEEDS_PROJECT', 'Выберите сборку, к которой относится покупка.');
      const [project] = await this.db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.ownerId, userId), isNull(schema.projects.deletedAt)));
      if (!project) throw fail(404, 'PROJECT_NOT_FOUND', 'Сборка не найдена.');
      const passes = await this.db.select({ to: schema.entitlements.validTo }).from(schema.entitlements).where(and(eq(schema.entitlements.projectId, id), eq(schema.entitlements.feature, 'PASS')));
      if (passes.length === 0) throw fail(409, 'ADDON_NOT_APPLICABLE', 'У этой сборки нет пропуска «Праздник». Сначала включите его.');
      if (effect === 'PASS_COMPLETIONS' && !passes.some((x) => x.to === null || x.to > now)) throw fail(409, 'ADDON_NOT_APPLICABLE', 'Пропуск «Праздник» у этой сборки закончился. Продлите его.');
      return { row, projectId: id };
    }
    if (effect === 'FREE_EXTRAS') {
      const [sub] = await this.db.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(and(eq(schema.subscriptions.userId, userId), inArray(schema.subscriptions.status, ['ACTIVE', 'TRIAL']), gt(schema.subscriptions.currentPeriodEnd, now))).limit(1);
      if (sub) throw fail(409, 'ADDON_NOT_APPLICABLE', 'Эта покупка только для тарифа «Старт».');
      return { row, projectId: null };
    }
    const [paid] = await this.db.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.status, 'ACTIVE'), eq(schema.subscriptions.trial, false), gt(schema.subscriptions.currentPeriodEnd, now))).limit(1);
    if (!paid) throw fail(409, 'ADDON_NOT_APPLICABLE', 'Эта покупка только для платной подписки.');
    return { row, projectId: null };
  }

  async myOrders(userId: string): Promise<OrderView[]> {
    return this.db
      .select({ id: schema.orders.id, kind: schema.orders.kind, status: schema.orders.status, amountKop: schema.orders.amountKop, item: schema.orders.item, createdAt: schema.orders.createdAt, paidAt: schema.orders.paidAt })
      .from(schema.orders)
      .where(eq(schema.orders.userId, userId))
      .orderBy(desc(schema.orders.createdAt))
      .limit(100);
  }

  /**
   * Уведомление провайдера. Ему не верится на слово: платёж перечитывается у провайдера по номеру, и только его ответ
   * решает. Подделка (платежа нет у провайдера) — 400; сбой связи — 502, чтобы провайдер повторил позже.
   */
  async handleNotification(body: unknown): Promise<{ ok: true; duplicate?: boolean }> {
    const provider = this.requireProvider();
    const event = (body as { event?: unknown } | null)?.event;
    const object = (body as { object?: { id?: unknown; payment_id?: unknown } } | null)?.object;
    const isRefund = event === 'refund.succeeded';
    const paymentId = isRefund ? object?.payment_id : object?.id;
    if (typeof event !== 'string' || typeof paymentId !== 'string') throw fail(400, 'BAD_NOTIFICATION', 'Непонятное уведомление.');
    let payment;
    try {
      payment = await provider.getPayment(paymentId);
    } catch (e) {
      if (e instanceof PaymentProviderError) throw fail(502, 'PROVIDER_UNREACHABLE', 'Платёж не удалось проверить, повторите позже.');
      throw e;
    }
    if (!payment) throw fail(400, 'UNKNOWN_PAYMENT', 'Такого платежа нет.');
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.provider, provider.name), eq(schema.orders.providerPaymentId, payment.id)));
    if (!order || payment.orderId !== order.id || payment.amountKop !== order.amountKop) throw fail(400, 'ORDER_MISMATCH', 'Платёж не совпадает с заказом.');

    if (isRefund) return this.markRefunded(order.id);
    if (payment.status === 'succeeded') return this.markPaid(order.id);
    if (payment.status === 'canceled') {
      const canceled = await this.db.update(schema.orders).set({ status: 'CANCELED' }).where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, 'PENDING'))).returning({ id: schema.orders.id });
      // The use of a promo code goes back when the payment is canceled.
      if (canceled.length > 0) await this.promos.release({ orderId: order.id });
    }
    return { ok: true };
  }

  /** PENDING → PAID ровно один раз: второй и пятый повтор уведомления упираются в условие статуса и ничего не выдают. */
  private async markPaid(orderId: string): Promise<{ ok: true; duplicate?: boolean }> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [order] = await tx
        .update(schema.orders)
        .set({ status: 'PAID', paidAt: now })
        .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, 'PENDING')))
        .returning();
      if (!order) return { ok: true as const, duplicate: true };
      if (!order.userId) return { ok: true as const };
      const item = order.item as { kind?: string; planCode?: string; period?: 'MONTH' | 'YEAR'; projectId?: string };
      if (order.kind === 'SUBSCRIPTION' && item.planCode && item.period) {
        const [current] = await tx
          .select()
          .from(schema.subscriptions)
          .where(and(eq(schema.subscriptions.userId, order.userId), eq(schema.subscriptions.planCode, item.planCode), eq(schema.subscriptions.status, 'ACTIVE'), gt(schema.subscriptions.currentPeriodEnd, now)))
          .orderBy(desc(schema.subscriptions.currentPeriodEnd))
          .limit(1);
        // Пробный период заканчивается оплатой; продление идёт от конца уже оплаченного срока, а не от сегодняшнего дня.
        await tx
          .update(schema.subscriptions)
          .set({ status: 'EXPIRED' })
          .where(and(eq(schema.subscriptions.userId, order.userId), eq(schema.subscriptions.status, 'TRIAL')));
        if (current) {
          await tx.update(schema.subscriptions).set({ currentPeriodEnd: addPeriod(current.currentPeriodEnd, item.period) }).where(eq(schema.subscriptions.id, current.id));
        } else {
          await tx.insert(schema.subscriptions).values({ userId: order.userId, planCode: item.planCode, period: item.period, status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: addPeriod(now, item.period) });
        }
      } else if (order.kind === 'PASS' && item.projectId) {
        const [plan] = await tx.select({ limits: schema.plans.limits }).from(schema.plans).where(eq(schema.plans.code, 'PASS'));
        const days = plan?.limits.passDays ?? 30;
        const [active] = await tx
          .select()
          .from(schema.entitlements)
          .where(and(eq(schema.entitlements.projectId, item.projectId), eq(schema.entitlements.feature, 'PASS'), or(isNull(schema.entitlements.validTo), gt(schema.entitlements.validTo, now))))
          .orderBy(desc(schema.entitlements.validTo))
          .limit(1);
        const from = active?.validTo && active.validTo > now ? active.validTo : now;
        // A renewal keeps the start of the pass it continues, so the passages of the term are counted from the first day.
        await tx.insert(schema.entitlements).values({ userId: order.userId, projectId: item.projectId, feature: 'PASS', validFrom: active?.validTo && active.validTo > now ? active.validFrom : now, validTo: new Date(from.getTime() + days * 86_400_000), sourceOrderId: order.id });
      } else if (order.kind === 'ADDON' && (item as { addon?: string }).addon) {
        await this.grantAddon(tx, order, item as { addon: string; projectId?: string }, now);
      }
      return { ok: true as const };
    });
  }

  /** P7.5 · what a paid extra purchase gives; the rights are rows of `entitlements` tied to the order, so a refund closes them. */
  private async grantAddon(tx: Parameters<Parameters<Db['transaction']>[0]>[0], order: typeof schema.orders.$inferSelect, item: { addon: string; projectId?: string }, now: Date): Promise<void> {
    const [addon] = await tx.select().from(schema.addons).where(eq(schema.addons.code, item.addon));
    if (!addon || !order.userId) return;
    const p = addon.params;
    const months = (n: number): Date => addMonths(now, n);
    const base = { userId: order.userId, validFrom: now, sourceOrderId: order.id };
    switch (p.effect) {
      case 'PASS_COMPLETIONS': {
        if (!item.projectId) return;
        const [pass] = await tx
          .select({ to: schema.entitlements.validTo })
          .from(schema.entitlements)
          .where(and(eq(schema.entitlements.projectId, item.projectId), eq(schema.entitlements.feature, 'PASS'), or(isNull(schema.entitlements.validTo), gt(schema.entitlements.validTo, now))))
          .orderBy(desc(schema.entitlements.validTo))
          .limit(1);
        await tx.insert(schema.entitlements).values({ ...base, projectId: item.projectId, feature: 'EXTRA_COMPLETIONS', quantity: p.quantity ?? 0, validTo: pass?.to ?? now });
        return;
      }
      case 'PASS_EXTEND': {
        if (!item.projectId) return;
        const [plan] = await tx.select({ limits: schema.plans.limits }).from(schema.plans).where(eq(schema.plans.code, 'PASS'));
        const days = p.days ?? plan?.limits.passDays ?? 30;
        const [last] = await tx
          .select({ to: schema.entitlements.validTo, from: schema.entitlements.validFrom })
          .from(schema.entitlements)
          .where(and(eq(schema.entitlements.projectId, item.projectId), eq(schema.entitlements.feature, 'PASS')))
          .orderBy(desc(schema.entitlements.validTo))
          .limit(1);
        const running = Boolean(last?.to && last.to > now);
        const from = running ? last!.to! : now;
        await tx.insert(schema.entitlements).values({ ...base, projectId: item.projectId, feature: 'PASS', validFrom: running ? last!.from : now, validTo: new Date(from.getTime() + days * 86_400_000) });
        return;
      }
      case 'SUBSCRIPTION_COMPLETIONS':
        await tx.insert(schema.entitlements).values({ ...base, feature: 'EXTRA_COMPLETIONS', quantity: p.quantity ?? 0, validTo: months(p.months ?? 12) });
        return;
      case 'SUBSCRIPTION_STORAGE':
        await tx.insert(schema.entitlements).values({ ...base, feature: 'EXTRA_STORAGE', quantity: Math.round((p.quantity ?? 0) / MB), validTo: months(p.months ?? 1) });
        return;
      case 'FREE_EXTRAS':
        await tx.insert(schema.entitlements).values([
          { ...base, feature: 'EXTRA_THEMES', quantity: p.themes ?? 0, validTo: null },
          { ...base, feature: 'EXTRA_RULES', quantity: p.rules ?? 0, validTo: null },
        ]);
        return;
    }
  }

  /** PAID → REFUNDED: права, выданные этим заказом, закрываются сразу. */
  private async markRefunded(orderId: string): Promise<{ ok: true; duplicate?: boolean }> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [order] = await tx
        .update(schema.orders)
        .set({ status: 'REFUNDED', refundedAt: now })
        .where(and(eq(schema.orders.id, orderId), inArray(schema.orders.status, ['PAID'])))
        .returning();
      if (!order) return { ok: true as const, duplicate: true };
      await tx.update(schema.entitlements).set({ validTo: now }).where(eq(schema.entitlements.sourceOrderId, order.id));
      const item = order.item as { planCode?: string; period?: 'MONTH' | 'YEAR' };
      if (order.kind === 'SUBSCRIPTION' && order.userId && item.planCode) {
        await tx
          .update(schema.subscriptions)
          .set({ status: 'CANCELED', canceledAt: now, currentPeriodEnd: now })
          .where(and(eq(schema.subscriptions.userId, order.userId), eq(schema.subscriptions.planCode, item.planCode), eq(schema.subscriptions.status, 'ACTIVE')));
      }
      return { ok: true as const };
    });
  }

  /** Возврат полной суммы заказа (кнопка в админке — P7.7): статус меняется, когда провайдер подтвердит возврат уведомлением. */
  async refund(orderId: string): Promise<{ refundId: string; status: string }> {
    const provider = this.requireProvider();
    const [order] = await this.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    if (!order || order.status !== 'PAID' || !order.providerPaymentId) throw fail(409, 'REFUND_IMPOSSIBLE', 'Вернуть можно только оплаченный заказ.');
    try {
      return await provider.refund({ providerPaymentId: order.providerPaymentId, amountKop: order.amountKop, idempotenceKey: `refund-${order.id}` });
    } catch (e) {
      if (e instanceof PaymentProviderError) throw fail(502, 'PAYMENTS_FAILED', 'Платёжный сервис отказал в возврате.');
      throw e;
    }
  }
}
