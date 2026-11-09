import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { AuditLogService } from '../auth/audit-log.service.js';
import { DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

export type OrderKindName = 'SUBSCRIPTION' | 'PASS' | 'ADDON';
const ORDER_KINDS: readonly OrderKindName[] = ['SUBSCRIPTION', 'PASS', 'ADDON'];
/** The least the payment provider takes: one rouble. */
const MIN_KOP = 100;

export interface PromoQuote {
  promoId: string;
  code: string;
  listKop: number;
  discountKop: number;
  /** What the person pays; 0 for a free pass. */
  finalKop: number;
}

export interface PromoView {
  id: string;
  code: string;
  kind: schema.PromoKind;
  value: number;
  appliesTo: string[];
  maxActivations: number | null;
  activations: number;
  validFrom: Date | null;
  validTo: Date | null;
  active: boolean;
  note: string;
  createdAt: Date;
}

export const normalizeCode = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().toUpperCase() : '');

/** The discount in kopecks of a code on a price; pure, so the page can show the price before the payment. */
export function discountOf(kind: schema.PromoKind, value: number, listKop: number): { discountKop: number; finalKop: number } {
  if (kind === 'FREE_PASS') return { discountKop: listKop, finalKop: 0 };
  const raw = kind === 'PERCENT' ? Math.floor((listKop * value) / 100) : value * 100;
  // A paid order never falls below one rouble: the provider does not take less.
  const discountKop = Math.max(0, Math.min(raw, listKop - MIN_KOP));
  return { discountKop, finalKop: listKop - discountKop };
}

/**
 * P7.5 · AD-05 · promo codes: a percent off, a fixed sum off or a free pass «Праздник», with a limit of uses and a term.
 * A use is reserved when the order is made (so two people cannot take the last use together) and given back if the payment fails
 * or is canceled; one person uses one code once.
 */
@Injectable()
export class PromoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogService,
  ) {}

  /** Why a code does not work for this person and this order, or the code itself when it does. */
  private async check(db: Pick<Db, 'select'>, userId: string, raw: unknown, kind: OrderKindName | null, now: Date, forUpdate = false): Promise<typeof schema.promoCodes.$inferSelect> {
    const code = normalizeCode(raw);
    if (!code) throw fail(400, 'PROMO_INVALID', 'Введите промокод.');
    const query = db.select().from(schema.promoCodes).where(eq(schema.promoCodes.code, code));
    const [promo] = await (forUpdate ? query.for('update') : query);
    if (!promo || !promo.active) throw fail(400, 'PROMO_INVALID', 'Такого промокода нет.');
    if (promo.validFrom && promo.validFrom > now) throw fail(400, 'PROMO_NOT_STARTED', 'Этот промокод ещё не действует.');
    if (promo.validTo && promo.validTo <= now) throw fail(400, 'PROMO_EXPIRED', 'Срок действия промокода закончился.');
    if (kind !== null && !promo.appliesTo.includes(kind)) {
      throw fail(400, 'PROMO_NOT_APPLICABLE', promo.kind === 'FREE_PASS' ? 'Этот промокод даёт бесплатный «Праздник» и не подходит к этой покупке.' : 'Этот промокод не подходит к этой покупке.');
    }
    const [mine] = await db
      .select({ id: schema.promoRedemptions.id, orderStatus: schema.orders.status })
      .from(schema.promoRedemptions)
      .leftJoin(schema.orders, eq(schema.orders.id, schema.promoRedemptions.orderId))
      .where(and(eq(schema.promoRedemptions.promoId, promo.id), eq(schema.promoRedemptions.userId, userId)));
    // A use that never became a paid order does not count: the person may try again.
    if (mine && mine.orderStatus && (mine.orderStatus === 'PAID' || mine.orderStatus === 'REFUNDED')) throw fail(400, 'PROMO_USED', 'Вы уже использовали этот промокод.');
    // The person's own unpaid use is theirs to take again, so it does not count against the limit.
    if (promo.maxActivations !== null && promo.activations - (mine ? 1 : 0) >= promo.maxActivations) throw fail(400, 'PROMO_EXHAUSTED', 'Промокод уже использован максимальное число раз.');
    return promo;
  }

  /** The price with the code, without using it: for the line «К оплате» before the payment. */
  async quote(userId: string, raw: unknown, kind: OrderKindName, listKop: number, now = new Date()): Promise<PromoQuote> {
    const promo = await this.check(this.db, userId, raw, kind, now);
    return { promoId: promo.id, code: promo.code, listKop, ...discountOf(promo.kind, promo.value, listKop) };
  }

  /** What a code gives, for the page «Тариф и оплата» where nothing is being bought yet: it works for this person, or the reason it does not. */
  async describe(userId: string, raw: unknown, now = new Date()): Promise<{ code: string; kind: schema.PromoKind; value: number; appliesTo: string[] }> {
    const promo = await this.check(this.db, userId, raw, null, now);
    return { code: promo.code, kind: promo.kind, value: promo.value, appliesTo: promo.appliesTo };
  }

  /** Takes one use for the person; the order is attached by `attach`. Returns the price with the discount. */
  async reserve(userId: string, raw: unknown, kind: OrderKindName, listKop: number, now = new Date()): Promise<PromoQuote & { redemptionId: string }> {
    return this.db.transaction(async (tx) => {
      const promo = await this.check(tx, userId, raw, kind, now, true);
      // An earlier unpaid use by this person is given back first, so the count stays right.
      const released = await tx
        .delete(schema.promoRedemptions)
        .where(and(eq(schema.promoRedemptions.promoId, promo.id), eq(schema.promoRedemptions.userId, userId)))
        .returning({ id: schema.promoRedemptions.id });
      if (released.length > 0) await tx.update(schema.promoCodes).set({ activations: sql`${schema.promoCodes.activations} - 1` }).where(eq(schema.promoCodes.id, promo.id));
      if (promo.maxActivations !== null && promo.activations - released.length >= promo.maxActivations) throw fail(400, 'PROMO_EXHAUSTED', 'Промокод уже использован максимальное число раз.');
      const [redemption] = await tx.insert(schema.promoRedemptions).values({ promoId: promo.id, userId }).returning({ id: schema.promoRedemptions.id });
      await tx.update(schema.promoCodes).set({ activations: sql`${schema.promoCodes.activations} + 1` }).where(eq(schema.promoCodes.id, promo.id));
      return { redemptionId: redemption!.id, promoId: promo.id, code: promo.code, listKop, ...discountOf(promo.kind, promo.value, listKop) };
    });
  }

  async attach(redemptionId: string, orderId: string): Promise<void> {
    await this.db.update(schema.promoRedemptions).set({ orderId }).where(eq(schema.promoRedemptions.id, redemptionId));
  }

  /** Gives the use back: the order was not made, or the payment was canceled. */
  async release(by: { redemptionId: string } | { orderId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const gone = await tx
        .delete(schema.promoRedemptions)
        .where('redemptionId' in by ? eq(schema.promoRedemptions.id, by.redemptionId) : eq(schema.promoRedemptions.orderId, by.orderId))
        .returning({ promoId: schema.promoRedemptions.promoId });
      for (const r of gone) await tx.update(schema.promoCodes).set({ activations: sql`${schema.promoCodes.activations} - 1` }).where(eq(schema.promoCodes.id, r.promoId));
    });
  }

  // ── Admin (AD-05) ────────────────────────────────────────────────────────

  async list(): Promise<PromoView[]> {
    return this.db.select().from(schema.promoCodes).orderBy(desc(schema.promoCodes.createdAt)).limit(500);
  }

  async create(actorId: string, body: Record<string, unknown>, ip?: string): Promise<PromoView> {
    const code = normalizeCode(body.code);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw fail(400, 'INVALID_INPUT', 'Код — от 3 до 32 знаков: латинские буквы, цифры, «-» и «_».');
    const kind = body.kind;
    if (kind !== 'PERCENT' && kind !== 'FIXED' && kind !== 'FREE_PASS') throw fail(400, 'INVALID_INPUT', 'Выберите вид скидки.');
    let value = 0;
    if (kind === 'PERCENT') {
      value = Number(body.value);
      if (!Number.isInteger(value) || value < 1 || value > 99) throw fail(400, 'INVALID_INPUT', 'Скидка в процентах — целое число от 1 до 99.');
    } else if (kind === 'FIXED') {
      value = Number(body.value);
      if (!Number.isInteger(value) || value < 1 || value > 100_000) throw fail(400, 'INVALID_INPUT', 'Скидка в рублях — целое число от 1 до 100 000.');
    }
    const asked = Array.isArray(body.appliesTo) ? body.appliesTo : [...ORDER_KINDS];
    // A free pass is a pass by definition.
    const appliesTo = kind === 'FREE_PASS' ? ['PASS'] : ORDER_KINDS.filter((k) => asked.includes(k));
    if (appliesTo.length === 0) throw fail(400, 'INVALID_INPUT', 'Выберите, к чему подходит промокод.');
    const max = body.maxActivations === null || body.maxActivations === undefined || body.maxActivations === '' ? null : Number(body.maxActivations);
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > 1_000_000)) throw fail(400, 'INVALID_INPUT', 'Число активаций — целое от 1 до 1 000 000 или пусто (без ограничения).');
    const date = (v: unknown): Date | null => {
      if (v === null || v === undefined || v === '') return null;
      const d = typeof v === 'string' ? new Date(v) : new Date(NaN);
      if (Number.isNaN(d.getTime())) throw fail(400, 'INVALID_INPUT', 'Дата указана неверно.');
      return d;
    };
    const validFrom = date(body.validFrom);
    const validTo = date(body.validTo);
    if (validFrom && validTo && validTo <= validFrom) throw fail(400, 'INVALID_INPUT', 'Срок окончания должен быть позже начала.');
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
    const [dup] = await this.db.select({ id: schema.promoCodes.id }).from(schema.promoCodes).where(eq(schema.promoCodes.code, code));
    if (dup) throw fail(409, 'PROMO_EXISTS', 'Такой промокод уже есть.');
    const [row] = await this.db.insert(schema.promoCodes).values({ code, kind, value, appliesTo, maxActivations: max, validFrom, validTo, note, createdById: actorId }).returning();
    await this.audit.log({ actorId, action: 'PROMO_CREATED', targetType: 'PROMO_CODE', targetId: row!.id, ...(ip ? { ip } : {}), meta: { code, kind, value, appliesTo, maxActivations: max } });
    return row!;
  }

  /** Only the term, the limit, the note and the switch change; the kind and the size of a discount never do (the orders already made refer to them). */
  async update(actorId: string, id: string, body: Record<string, unknown>, ip?: string): Promise<PromoView> {
    const [row] = await this.db.select().from(schema.promoCodes).where(eq(schema.promoCodes.id, id));
    if (!row) throw fail(404, 'NOT_FOUND', 'Промокод не найден.');
    const set: Partial<typeof schema.promoCodes.$inferInsert> = {};
    if (typeof body.active === 'boolean') set.active = body.active;
    if ('maxActivations' in body) {
      const max = body.maxActivations === null || body.maxActivations === '' ? null : Number(body.maxActivations);
      if (max !== null && (!Number.isInteger(max) || max < Math.max(1, row.activations) || max > 1_000_000)) throw fail(400, 'INVALID_INPUT', 'Лимит — целое число не меньше уже использованного.');
      set.maxActivations = max;
    }
    if ('validTo' in body) {
      const d = body.validTo === null || body.validTo === '' ? null : typeof body.validTo === 'string' ? new Date(body.validTo) : new Date(NaN);
      if (d && Number.isNaN(d.getTime())) throw fail(400, 'INVALID_INPUT', 'Дата указана неверно.');
      if (d && row.validFrom && d <= row.validFrom) throw fail(400, 'INVALID_INPUT', 'Срок окончания должен быть позже начала.');
      set.validTo = d;
    }
    if (typeof body.note === 'string') set.note = body.note.slice(0, 300);
    if (Object.keys(set).length === 0) return row;
    const [updated] = await this.db.update(schema.promoCodes).set(set).where(eq(schema.promoCodes.id, id)).returning();
    await this.audit.log({ actorId, action: 'PROMO_CHANGED', targetType: 'PROMO_CODE', targetId: id, ...(ip ? { ip } : {}), meta: { code: row.code, changes: Object.keys(set) } });
    return updated!;
  }
}
