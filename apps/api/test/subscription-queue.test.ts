import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@blokum/db';
import { EntitlementsService } from '../src/entitlements/entitlements.service.js';
import { BillingService } from '../src/payments/billing.service.js';
import { RenewalRemindersService } from '../src/payments/renewal-reminders.service.js';
import type { NotificationsService } from '../src/admin/notifications.service.js';
import { addMonths, addSubscription, layoutAllOverlapping, layoutSubscriptions, takeBackSubscription } from '../src/payments/subscription-queue.js';
import { createTestDb, type TestDb } from './helpers.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-20T14:11:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('ADR-126 · очередь подписок: ни один оплаченный день не пропадает', () => {
  let db: TestDb;
  let plans: EntitlementsService;
  let billing: BillingService;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDb();
    plans = new EntitlementsService(db.db);
    billing = new BillingService(db.db, plans);
  });
  afterAll(async () => {
    await db?.drop();
  });

  async function user(): Promise<string> {
    const [u] = await db.db.insert(schema.users).values({ displayName: 'Тест', phoneE164: `+7901${String(1000000 + ++n)}` }).returning();
    return u!.id;
  }
  const subs = async (userId: string) =>
    (
      await db.db
        .select({ planCode: schema.subscriptions.planCode, start: schema.subscriptions.currentPeriodStart, end: schema.subscriptions.currentPeriodEnd })
        .from(schema.subscriptions)
        .where(and(eq(schema.subscriptions.userId, userId), inArray(schema.subscriptions.status, ['ACTIVE'])))
        .orderBy(asc(schema.subscriptions.currentPeriodStart))
    ).map((s) => ({ plan: s.planCode, start: s.start.toISOString(), end: s.end.toISOString() }));

  it('ADR-126 · младший тариф при действующем старшем начнётся, когда старший закончится (случай владельца 20.11: «Плюс» до 15.12 + «Автор» на месяц)', async () => {
    const u = await user();
    const plusEnd = new Date('2026-12-15T10:00:00Z');
    await db.db.insert(schema.subscriptions).values({ userId: u, planCode: 'PLUS', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date('2026-11-15T10:00:00Z'), currentPeriodEnd: plusEnd });
    await addSubscription(db.db, u, 'AUTHOR', 1, 'MONTH', NOW);
    const authorMonth = addMonths(NOW, 1).getTime() - NOW.getTime();
    expect(await subs(u)).toEqual([
      { plan: 'PLUS', start: '2026-11-15T10:00:00.000Z', end: plusEnd.toISOString() },
      { plan: 'AUTHOR', start: plusEnd.toISOString(), end: new Date(plusEnd.getTime() + authorMonth).toISOString() },
    ]);
    // Сейчас работает «Плюс»; «Автор» в очереди; страница оплаты показывает конец «Плюса», а не «Автора».
    expect((await plans.planOf(u, NOW)).code).toBe('PLUS');
    expect((await plans.planOf(u, at(30))).code).toBe('AUTHOR');
    const state = await billing.state(u, NOW);
    expect(state.plan.code).toBe('PLUS');
    expect(state.subscription?.currentPeriodEnd.toISOString()).toBe(plusEnd.toISOString());
    expect(state.queued.map((q) => ({ plan: q.planCode, title: q.title, start: q.start.toISOString() }))).toEqual([{ plan: 'AUTHOR', title: 'Автор', start: plusEnd.toISOString() }]);
  });

  it('ADR-126 · старший тариф начинается сразу, оставшиеся дни младшего переносятся на после него', async () => {
    const u = await user();
    await db.db.insert(schema.subscriptions).values({ userId: u, planCode: 'AUTHOR', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: at(-20), currentPeriodEnd: at(10) });
    await addSubscription(db.db, u, 'PRO', 1, 'MONTH', NOW);
    const proEnd = addMonths(NOW, 1);
    expect(await subs(u)).toEqual([
      { plan: 'PRO', start: NOW.toISOString(), end: proEnd.toISOString() },
      { plan: 'AUTHOR', start: proEnd.toISOString(), end: new Date(proEnd.getTime() + 10 * DAY).toISOString() },
    ]);
    expect((await plans.planOf(u, NOW)).code).toBe('PRO');
  });

  it('ADR-126 · тот же тариф продлевается от своего конца, а ждущий в очереди сдвигается следом', async () => {
    const u = await user();
    await db.db.insert(schema.subscriptions).values({ userId: u, planCode: 'PLUS', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: at(-5), currentPeriodEnd: at(25) });
    await addSubscription(db.db, u, 'AUTHOR', 1, 'MONTH', NOW);
    await addSubscription(db.db, u, 'PLUS', 1, 'MONTH', NOW);
    const plusEnd = addMonths(at(25), 1);
    const [plus, author] = await subs(u);
    expect(plus).toEqual({ plan: 'PLUS', start: at(-5).toISOString(), end: plusEnd.toISOString() });
    expect(author!.start).toBe(plusEnd.toISOString());
    expect(new Date(author!.end).getTime() - plusEnd.getTime()).toBe(addMonths(NOW, 1).getTime() - NOW.getTime());
  });

  it('ADR-126 · возврат забирает только свой срок; ничего не осталось — тариф снят, очередь сдвигается вперёд', async () => {
    const u = await user();
    await addSubscription(db.db, u, 'PLUS', 1, 'MONTH', NOW);
    await addSubscription(db.db, u, 'PLUS', 1, 'MONTH', NOW);
    await addSubscription(db.db, u, 'AUTHOR', 1, 'MONTH', NOW);
    await takeBackSubscription(db.db, u, 'PLUS', 1, NOW);
    const [plus, author] = await subs(u);
    expect(plus!.plan).toBe('PLUS');
    expect(new Date(plus!.end).getTime()).toBe(addMonths(NOW, 1).getTime());
    expect(author!.start).toBe(plus!.end);
    await takeBackSubscription(db.db, u, 'PLUS', 1, NOW);
    const left = await subs(u);
    expect(left.map((s) => s.plan)).toEqual(['AUTHOR']);
    expect(left[0]!.start).toBe(NOW.toISOString());
    expect((await plans.planOf(u, NOW)).code).toBe('AUTHOR');
  });

  it('ADR-126 · подписки, купленные до очереди и идущие одновременно, выстраиваются при запуске один раз; повтор ничего не меняет', async () => {
    const u = await user();
    await db.db.insert(schema.subscriptions).values([
      { userId: u, planCode: 'PLUS', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: at(-5), currentPeriodEnd: at(25) },
      { userId: u, planCode: 'AUTHOR', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: NOW, currentPeriodEnd: at(30) },
    ]);
    expect(await layoutAllOverlapping(db.db, NOW)).toBeGreaterThanOrEqual(1);
    const once = await subs(u);
    expect(once).toEqual([
      { plan: 'PLUS', start: at(-5).toISOString(), end: at(25).toISOString() },
      { plan: 'AUTHOR', start: at(25).toISOString(), end: at(55).toISOString() },
    ]);
    await layoutSubscriptions(db.db, u, NOW);
    expect(await subs(u)).toEqual(once);
  });

  it('ADR-126 · оплата заканчивает пробный период', async () => {
    const u = await user();
    await db.db.insert(schema.subscriptions).values({ userId: u, planCode: 'AUTHOR', period: 'MONTH', status: 'TRIAL', trial: true, currentPeriodStart: at(-1), currentPeriodEnd: at(2) });
    await addSubscription(db.db, u, 'PLUS', 1, 'MONTH', NOW);
    const trial = await db.db.select({ status: schema.subscriptions.status }).from(schema.subscriptions).where(and(eq(schema.subscriptions.userId, u), eq(schema.subscriptions.trial, true)));
    expect(trial[0]!.status).toBe('EXPIRED');
    expect((await plans.planOf(u, NOW)).code).toBe('PLUS');
  });
  it('ADR-126 · напоминание «тариф заканчивается» не приходит, если следом в очереди другой оплаченный тариф', async () => {
    const queued = await user();
    const alone = await user();
    await db.db.insert(schema.subscriptions).values([
      { userId: queued, planCode: 'PLUS', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: at(-28), currentPeriodEnd: at(2) },
      { userId: queued, planCode: 'AUTHOR', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: at(2), currentPeriodEnd: at(32) },
      { userId: alone, planCode: 'PLUS', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: at(-28), currentPeriodEnd: at(2) },
    ]);
    const sent: string[] = [];
    const notices = { notify: (n: { userId: string }) => (sent.push(n.userId), Promise.resolve()) } as unknown as NotificationsService;
    await new RenewalRemindersService(db.db, notices).run(NOW);
    expect(sent).toContain(alone);
    expect(sent).not.toContain(queued);
  });
});
