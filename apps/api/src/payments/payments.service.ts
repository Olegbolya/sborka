import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB, PAYMENT_PROVIDER } from '../tokens.js';
import { type PaymentProvider, PaymentProviderError } from './payment-provider.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

export type OrderRequest = { kind?: unknown; planCode?: unknown; period?: unknown; projectId?: unknown };
export interface OrderView {
  id: string;
  kind: 'SUBSCRIPTION' | 'PASS' | 'ADDON';
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  amountKop: number;
  item: Record<string, unknown>;
  createdAt: Date;
  paidAt: Date | null;
}

/** Прибавляет к дате месяц или год (по UTC; 31 января + месяц = последний день февраля). */
export function addPeriod(from: Date, period: 'MONTH' | 'YEAR'): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (period === 'MONTH' ? 1 : 12));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
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
  ) {}

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw fail(503, 'PAYMENTS_UNAVAILABLE', 'Оплата пока не подключена. Попробуйте позже.');
    return this.provider;
  }

  /** Создаёт заказ «подписка» или «пропуск» и платёж у провайдера; человек идёт оплачивать по `confirmationUrl`. */
  async createOrder(userId: string, body: OrderRequest): Promise<{ orderId: string; confirmationUrl: string }> {
    const provider = this.requireProvider();
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
    } else {
      throw fail(400, 'ORDER_INVALID', 'Неизвестный вид заказа.');
    }
    const [order] = await this.db
      .insert(schema.orders)
      .values({ userId, kind, item, amountKop, provider: provider.name })
      .returning({ id: schema.orders.id });
    try {
      const created = await provider.createPayment({ orderId: order!.id, amountKop, description, returnUrl: `${this.config.webUrl}/cabinet/billing?order=${order!.id}` });
      await this.db.update(schema.orders).set({ providerPaymentId: created.providerPaymentId }).where(eq(schema.orders.id, order!.id));
      return { orderId: order!.id, confirmationUrl: created.confirmationUrl };
    } catch (e) {
      await this.db.update(schema.orders).set({ status: 'CANCELED' }).where(eq(schema.orders.id, order!.id));
      if (e instanceof PaymentProviderError) throw fail(502, 'PAYMENTS_FAILED', 'Платёжный сервис сейчас не отвечает. Попробуйте позже.');
      throw e;
    }
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
      await this.db.update(schema.orders).set({ status: 'CANCELED' }).where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, 'PENDING')));
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
        await tx.insert(schema.entitlements).values({ userId: order.userId, projectId: item.projectId, feature: 'PASS', validFrom: now, validTo: new Date(from.getTime() + days * 86_400_000), sourceOrderId: order.id });
      }
      return { ok: true as const };
    });
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
