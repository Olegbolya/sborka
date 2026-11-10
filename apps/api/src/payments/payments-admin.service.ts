import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, like, or, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { AuditLogService } from '../auth/audit-log.service.js';
import { DB } from '../tokens.js';
import { type IncomeView, NpdIncomeService } from './npd-income.service.js';
import { addMonths, PaymentsService } from './payments.service.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

export interface AdminOrderView {
  id: string;
  kind: string;
  status: string;
  amountKop: number;
  payerType: string;
  payerInn: string | null;
  provider: string;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  item: Record<string, unknown>;
  user: { id: string; displayName: string | null } | null;
}

/**
 * P7.7 · AD-05, AD-12 · what the administrator does with payments: sees the orders, returns money, gives a plan or a pass by hand,
 * and watches the income of the self-employed against the yearly limit. Every action goes to the audit log.
 */
@Injectable()
export class PaymentsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly payments: PaymentsService,
    private readonly audit: AuditLogService,
    private readonly npd: NpdIncomeService,
  ) {}

  // ── Income (AD-12) ───────────────────────────────────────────────────────

  income(now = new Date()): Promise<IncomeView> {
    return this.npd.income(now);
  }

  async setLimit(actorId: string, rawRub: unknown, ip?: string): Promise<IncomeView> {
    const rub = Number(rawRub);
    if (!Number.isInteger(rub) || rub < 1000 || rub > 100_000_000) throw fail(400, 'INVALID_INPUT', 'Лимит — целое число рублей от 1 000 до 100 000 000.');
    await this.npd.saveLimit(actorId, rub);
    await this.audit.log({ actorId, action: 'NPD_LIMIT_CHANGED', targetType: 'SETTING', targetId: 'npd_limit_rub', ...(ip ? { ip } : {}), meta: { rub } });
    await this.npd.checkLimit();
    return this.npd.income();
  }

  // ── Orders ───────────────────────────────────────────────────────────────

  async orders(filter: { status?: string; kind?: string; q?: string; page?: number }): Promise<{ orders: AdminOrderView[]; total: number }> {
    const conds = [];
    if (filter.status && ['PENDING', 'PAID', 'CANCELED', 'REFUNDED'].includes(filter.status)) conds.push(eq(schema.orders.status, filter.status as 'PAID'));
    if (filter.kind && ['SUBSCRIPTION', 'PASS', 'ADDON'].includes(filter.kind)) conds.push(eq(schema.orders.kind, filter.kind as 'PASS'));
    const q = filter.q?.trim();
    if (q) conds.push(or(like(schema.orders.id, `${q.replace(/[%_]/g, '')}%`), like(schema.users.displayName, `%${q.replace(/[%_]/g, '')}%`)));
    const where = conds.length > 0 ? and(...conds) : undefined;
    const page = Math.max(0, Math.floor(filter.page ?? 0));
    const rows = await this.db
      .select({ order: schema.orders, userName: schema.users.displayName })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.users.id, schema.orders.userId))
      .where(where)
      .orderBy(desc(schema.orders.createdAt))
      .limit(50)
      .offset(page * 50);
    const [total] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.orders).leftJoin(schema.users, eq(schema.users.id, schema.orders.userId)).where(where);
    return {
      total: total?.n ?? 0,
      orders: rows.map(({ order: o, userName }) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        amountKop: o.amountKop,
        payerType: o.payerType,
        payerInn: o.payerInn,
        provider: o.provider,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        refundedAt: o.refundedAt,
        item: o.item,
        user: o.userId ? { id: o.userId, displayName: userName } : null,
      })),
    };
  }

  /** Who paid: a person (4 %) or a company or sole trader (6 %, the INN is required); changes the split of the income. */
  async setPayer(actorId: string, orderId: string, body: { payerType?: unknown; payerInn?: unknown }, ip?: string): Promise<AdminOrderView> {
    const payerType = body.payerType;
    if (payerType !== 'PERSON' && payerType !== 'BUSINESS') throw fail(400, 'INVALID_INPUT', 'Выберите плательщика: физлицо или юрлицо/ИП.');
    let inn: string | null = null;
    if (payerType === 'BUSINESS') {
      inn = typeof body.payerInn === 'string' ? body.payerInn.trim() : '';
      if (!/^(\d{10}|\d{12})$/.test(inn)) throw fail(400, 'INVALID_INPUT', 'ИНН — 10 цифр у организации или 12 у ИП.');
    }
    const [order] = await this.db.update(schema.orders).set({ payerType, payerInn: inn }).where(eq(schema.orders.id, orderId)).returning({ id: schema.orders.id });
    if (!order) throw fail(404, 'NOT_FOUND', 'Заказ не найден.');
    await this.audit.log({ actorId, action: 'ORDER_PAYER_CHANGED', targetType: 'ORDER', targetId: orderId, ...(ip ? { ip } : {}), meta: { payerType, hasInn: inn !== null } });
    await this.npd.checkLimit();
    const found = await this.orders({ q: orderId });
    return found.orders.find((o) => o.id === orderId)!;
  }

  /** The full return of an order (AD-05): the provider is asked; the order becomes «Возвращён» when the provider confirms. */
  async refund(actorId: string, orderId: string, reason: unknown, ip?: string): Promise<{ refundId: string; status: string }> {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < 3 || text.length > 300) throw fail(400, 'INVALID_INPUT', 'Напишите причину возврата — от 3 до 300 знаков.');
    const result = await this.payments.refund(orderId);
    await this.audit.log({ actorId, action: 'ORDER_REFUND_REQUESTED', targetType: 'ORDER', targetId: orderId, ...(ip ? { ip } : {}), meta: { reason: text, refundId: result.refundId } });
    return result;
  }

  // ── By hand (AD-05) ──────────────────────────────────────────────────────

  /**
   * A plan for some months or a pass for a project, given by the administrator with a reason (a gift, a compensation, a failed
   * payment). It is kept as a free order «manual», so it is in the list, and it is not income.
   */
  async grant(actorId: string, body: Record<string, unknown>, ip?: string): Promise<{ orderId: string }> {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 300) throw fail(400, 'INVALID_INPUT', 'Напишите причину начисления — от 3 до 300 знаков.');
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const [user] = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw fail(404, 'NOT_FOUND', 'Пользователь не найден.');
    const now = new Date();
    const kind = body.kind;
    return this.db.transaction(async (tx) => {
      if (kind === 'SUBSCRIPTION') {
        const planCode = typeof body.planCode === 'string' ? body.planCode : '';
        const months = Number(body.months);
        if (!Number.isInteger(months) || months < 1 || months > 36) throw fail(400, 'INVALID_INPUT', 'Срок — целое число месяцев от 1 до 36.');
        const [plan] = await tx.select({ code: schema.plans.code, priceOnceRub: schema.plans.priceOnceRub }).from(schema.plans).where(eq(schema.plans.code, planCode));
        if (!plan || plan.priceOnceRub !== null || plan.code === 'FREE') throw fail(400, 'INVALID_INPUT', 'Такого тарифа нет.');
        const [order] = await tx.insert(schema.orders).values({ userId, kind: 'SUBSCRIPTION', item: { kind: 'SUBSCRIPTION', planCode, period: 'MONTH', manual: true, months, reason, byAdmin: actorId }, amountKop: 0, status: 'PAID', provider: 'manual', paidAt: now }).returning({ id: schema.orders.id });
        await tx.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: addMonths(now, months) });
        await this.audit.log({ actorId, action: 'MANUAL_GRANT', targetType: 'USER', targetId: userId, ...(ip ? { ip } : {}), meta: { kind, planCode, months, reason, orderId: order!.id } });
        return { orderId: order!.id };
      }
      if (kind === 'PASS') {
        const projectId = typeof body.projectId === 'string' ? body.projectId : '';
        const [project] = await tx.select({ id: schema.projects.id, ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, projectId));
        if (!project || project.ownerId !== userId) throw fail(404, 'PROJECT_NOT_FOUND', 'У этого пользователя нет такой сборки.');
        const [plan] = await tx.select({ limits: schema.plans.limits }).from(schema.plans).where(eq(schema.plans.code, 'PASS'));
        const days = plan?.limits.passDays ?? 30;
        const [order] = await tx.insert(schema.orders).values({ userId, kind: 'PASS', item: { kind: 'PASS', planCode: 'PASS', projectId, manual: true, reason, byAdmin: actorId }, amountKop: 0, status: 'PAID', provider: 'manual', paidAt: now }).returning({ id: schema.orders.id });
        const [active] = await tx
          .select({ from: schema.entitlements.validFrom, to: schema.entitlements.validTo })
          .from(schema.entitlements)
          .where(and(eq(schema.entitlements.projectId, projectId), eq(schema.entitlements.feature, 'PASS'), gt(schema.entitlements.validTo, now)))
          .orderBy(desc(schema.entitlements.validTo))
          .limit(1);
        const from = active?.to ?? now;
        await tx.insert(schema.entitlements).values({ userId, projectId, feature: 'PASS', validFrom: active?.from ?? now, validTo: new Date(from.getTime() + days * 86_400_000), sourceOrderId: order!.id });
        await this.audit.log({ actorId, action: 'MANUAL_GRANT', targetType: 'USER', targetId: userId, ...(ip ? { ip } : {}), meta: { kind, projectId, days, reason, orderId: order!.id } });
        return { orderId: order!.id };
      }
      throw fail(400, 'INVALID_INPUT', 'Выберите, что начислить: тариф или «Праздник».');
    });
  }
}
