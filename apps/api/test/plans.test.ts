import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS, schema, seedPlans } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

type Body = { plans: Array<{ code: string; priceMonthRub: number | null; limits: { publishedProjects: number | null } }> };

describe('P10.1 · публичный список тарифов', () => {
  let t: TestApp;
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPlans(db.db);
    t = await startTestApp({ db: db.db });
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('P10.1 · отдаёт тарифы из таблицы без входа, по порядку и с лимитами', async () => {
    const res = await request(t.http()).get(`/${API_PREFIX}/plans`).expect(200);
    const { plans } = res.body as Body;
    expect(plans.map((p) => p.code)).toEqual(PLANS.map((p) => p.code));
    const plus = plans.find((p) => p.code === 'PLUS')!;
    expect(plus).toMatchObject({ title: 'Плюс', priceMonthRub: 349, priceYearRub: 2990 });
    expect(plus.limits.publishedProjects).toBe(100);
  });

  it('P10.1 · цена, изменённая в админке, сразу видна на сайте; скрытый тариф не показывается', async () => {
    await db.db.update(schema.plans).set({ priceMonthRub: 399 }).where(eq(schema.plans.code, 'PLUS'));
    await db.db.update(schema.plans).set({ public: false }).where(eq(schema.plans.code, 'BUSINESS'));
    const res = await request(t.http()).get(`/${API_PREFIX}/plans`).expect(200);
    const { plans } = res.body as Body;
    expect(plans.find((p) => p.code === 'PLUS')!.priceMonthRub).toBe(399);
    expect(plans.some((p) => p.code === 'BUSINESS')).toBe(false);
  });
});
