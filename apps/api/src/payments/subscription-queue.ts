import { and, eq, gt, inArray } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';

/**
 * ADR-126 · очередь подписок (решение владельца 20.11.2026). В каждый момент работает одна платная подписка — старшая из
 * купленных; остальные ждут своей очереди, и ни один оплаченный день не пропадает:
 * - купили тот же тариф — срок прибавляется к его концу;
 * - купили старший — он начинается сразу, а оставшиеся дни младшего переносятся на время после него;
 * - купили младший при действующем старшем — он начнётся, когда старший закончится.
 * Подписка «в очереди» — строка ACTIVE с `currentPeriodStart` в будущем: `planOf` берёт только начавшиеся.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | Tx;

interface Row {
  id: string;
  planCode: string;
  period: 'MONTH' | 'YEAR';
  start: Date;
  end: Date;
  sort: number;
}

async function rowsOf(db: Executor, userId: string, now: Date): Promise<Row[]> {
  return db
    .select({
      id: schema.subscriptions.id,
      planCode: schema.subscriptions.planCode,
      period: schema.subscriptions.period,
      start: schema.subscriptions.currentPeriodStart,
      end: schema.subscriptions.currentPeriodEnd,
      sort: schema.plans.sort,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.plans, eq(schema.plans.code, schema.subscriptions.planCode))
    .where(and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.status, 'ACTIVE'), gt(schema.subscriptions.currentPeriodEnd, now)));
}

/** What is still left of a subscription: from now (or from its start, if it waits) to its end. */
const leftOf = (r: Row, now: Date): number => r.end.getTime() - Math.max(r.start.getTime(), now.getTime());

/**
 * Puts the paid subscriptions of a person in order: one row per tariff, the oldest first; the first runs now (keeping its own
 * start), each next one starts when the previous ends. Doing it again changes nothing.
 */
export async function layoutSubscriptions(db: Executor, userId: string, now: Date = new Date()): Promise<void> {
  const rows = await rowsOf(db, userId, now);
  if (rows.length === 0) return;
  // One row per tariff: the time of the doubles is added to the one kept (it could only come from data before this rule).
  const byPlan = new Map<string, { keep: Row; left: number }>();
  for (const r of [...rows].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const seen = byPlan.get(r.planCode);
    if (!seen) {
      byPlan.set(r.planCode, { keep: r, left: leftOf(r, now) });
      continue;
    }
    seen.left += leftOf(r, now);
    await db.update(schema.subscriptions).set({ status: 'EXPIRED', currentPeriodEnd: now }).where(eq(schema.subscriptions.id, r.id));
  }
  const order = [...byPlan.values()].sort((a, b) => b.keep.sort - a.keep.sort);
  let cursor = now;
  order.forEach(({ keep, left }, i) => {
    const start = i === 0 && keep.start.getTime() <= now.getTime() ? keep.start : cursor;
    const end = new Date(cursor.getTime() + left);
    keep.start = start;
    keep.end = end;
    cursor = end;
  });
  for (const { keep } of order) {
    await db.update(schema.subscriptions).set({ currentPeriodStart: keep.start, currentPeriodEnd: keep.end }).where(eq(schema.subscriptions.id, keep.id));
  }
}

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


/**
 * A paid period of a tariff joins the queue: the same tariff gets longer by calendar months from its own end; a new tariff gets a
 * row; then the queue is laid out again. A trial ends with any payment (ADR-048).
 */
export async function addSubscription(db: Executor, userId: string, planCode: string, months: number, period: 'MONTH' | 'YEAR', now: Date = new Date()): Promise<void> {
  await db.update(schema.subscriptions).set({ status: 'EXPIRED' }).where(and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.status, 'TRIAL')));
  const rows = await rowsOf(db, userId, now);
  const same = rows.filter((r) => r.planCode === planCode).sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  if (same) {
    await db
      .update(schema.subscriptions)
      .set({ currentPeriodEnd: addMonths(same.end, months), period })
      .where(eq(schema.subscriptions.id, same.id));
  } else {
    await db.insert(schema.subscriptions).values({ userId, planCode, period, status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: addMonths(now, months) });
  }
  await layoutSubscriptions(db, userId, now);
}

/**
 * A refund takes back the time of the refunded order — calendar months counted back from the end of the tariff, the inverse of an
 * extension; nothing left — the tariff is canceled. The queue moves up.
 */
export async function takeBackSubscription(db: Executor, userId: string, planCode: string, months: number, now: Date = new Date()): Promise<void> {
  const rows = (await rowsOf(db, userId, now)).filter((r) => r.planCode === planCode);
  for (const r of rows) {
    const end = addMonths(r.end, -months);
    if (end.getTime() <= Math.max(r.start.getTime(), now.getTime())) {
      await db.update(schema.subscriptions).set({ status: 'CANCELED', canceledAt: now, currentPeriodEnd: now }).where(eq(schema.subscriptions.id, r.id));
    } else {
      await db.update(schema.subscriptions).set({ currentPeriodEnd: end }).where(eq(schema.subscriptions.id, r.id));
    }
  }
  await layoutSubscriptions(db, userId, now);
}

/** Users whose paid subscriptions overlap (from before ADR-126) — laid out once at the start of the API; it changes nothing twice. */
export async function layoutAllOverlapping(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ userId: schema.subscriptions.userId })
    .from(schema.subscriptions)
    .where(and(inArray(schema.subscriptions.status, ['ACTIVE']), gt(schema.subscriptions.currentPeriodEnd, now)));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.userId, (counts.get(r.userId) ?? 0) + 1);
  const many = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  for (const userId of many) await db.transaction((tx) => layoutSubscriptions(tx, userId, now));
  return many.length;
}
