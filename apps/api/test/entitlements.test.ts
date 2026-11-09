import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS, schema } from '@blokum/db';
import { EntitlementsService } from '../src/entitlements/entitlements.service.js';
import { createTestDb, type TestDb } from './helpers.js';

const NOW = new Date('2026-11-09T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

describe('P7.1 · Entitlements: тариф человека и сборки', () => {
  let db: TestDb;
  let svc: EntitlementsService;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDb();
    svc = new EntitlementsService(db.db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  async function user(): Promise<string> {
    const [u] = await db.db.insert(schema.users).values({ displayName: 'Тест', phoneE164: `+7900${String(1000000 + ++n)}` }).returning();
    return u!.id;
  }
  async function project(ownerId: string): Promise<string> {
    const [p] = await db.db.insert(schema.projects).values({ ownerId, title: 'Сборка', slug: `s-${++n}` }).returning();
    return p!.id;
  }
  async function subscribe(userId: string, planCode: string, status: 'ACTIVE' | 'TRIAL' | 'CANCELED', from: Date, to: Date): Promise<void> {
    await db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status, currentPeriodStart: from, currentPeriodEnd: to });
  }

  it('P7.1 · без подписки — «Старт» с лимитами из таблицы тарифов', async () => {
    const u = await user();
    const plan = await svc.planOf(u, NOW);
    expect(plan.code).toBe('FREE');
    expect(plan.limits).toEqual(PLANS.find((p) => p.code === 'FREE')!.limits);
    expect(await svc.has(u, 'watermark', NOW)).toBe(true);
  });

  it('P7.1 · каждый тариф отдаёт ровно свои лимиты (строки × тарифы)', async () => {
    for (const p of PLANS) {
      const u = await user();
      if (p.code !== 'FREE' && p.code !== 'PASS') await subscribe(u, p.code, 'ACTIVE', at(-1), at(29));
      if (p.code === 'PASS') continue; // «Праздник» — не подписка, см. тесты пропуска ниже
      expect((await svc.planOf(u, NOW)).limits, p.code).toEqual(p.limits);
    }
  });

  it('P7.1 · действующая подписка поднимает тариф, истёкшая и отменённая — нет', async () => {
    const active = await user();
    await subscribe(active, 'PLUS', 'ACTIVE', at(-5), at(25));
    expect((await svc.planOf(active, NOW)).code).toBe('PLUS');
    expect(await svc.has(active, 'watermark', NOW)).toBe(false);

    const expired = await user();
    await subscribe(expired, 'PLUS', 'ACTIVE', at(-40), at(-10));
    expect((await svc.planOf(expired, NOW)).code).toBe('FREE');

    const canceled = await user();
    await subscribe(canceled, 'PRO', 'CANCELED', at(-5), at(25));
    expect((await svc.planOf(canceled, NOW)).code).toBe('FREE');
  });

  it('P7.1 · пробный период «Автора» работает, пока не закончился, и после него — «Старт»', async () => {
    const u = await user();
    await subscribe(u, 'AUTHOR', 'TRIAL', at(-1), at(2));
    expect((await svc.planOf(u, NOW)).code).toBe('AUTHOR');
    expect((await svc.planOf(u, at(3))).code).toBe('FREE');
  });

  it('P7.1 · при нескольких подписках берётся старшая', async () => {
    const u = await user();
    await subscribe(u, 'AUTHOR', 'ACTIVE', at(-1), at(29));
    await subscribe(u, 'PRO', 'ACTIVE', at(-1), at(29));
    expect((await svc.planOf(u, NOW)).code).toBe('PRO');
  });

  it('P7.1 · пропуск «Праздник» поднимает лимиты только своей сборки и только на срок пропуска', async () => {
    const u = await user();
    const withPass = await project(u);
    const other = await project(u);
    await db.db.insert(schema.entitlements).values({ userId: u, projectId: withPass, feature: 'PASS', validFrom: at(-1), validTo: at(29) });
    const a = await svc.limitsOfProject(u, withPass, NOW);
    expect(a.plan.code).toBe('PASS');
    expect(a.plan.limits.watermark).toBe(false);
    expect(a.pass?.to.getTime()).toBe(at(29).getTime());
    expect((await svc.limitsOfProject(u, other, NOW)).plan.code).toBe('FREE');
    expect((await svc.limitsOfProject(u, withPass, at(30))).plan.code).toBe('FREE');
  });

  it('P7.1 · пропуск не понижает тариф: у «Про» остаётся «Про»', async () => {
    const u = await user();
    await subscribe(u, 'PRO', 'ACTIVE', at(-1), at(29));
    const p = await project(u);
    await db.db.insert(schema.entitlements).values({ userId: u, projectId: p, feature: 'PASS', validFrom: at(-1), validTo: at(29) });
    expect((await svc.limitsOfProject(u, p, NOW)).plan.code).toBe('PRO');
  });
});
