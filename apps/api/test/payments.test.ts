import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { EntitlementsService } from '../src/entitlements/entitlements.service.js';
import { YooKassaProvider } from '../src/payments/yookassa.provider.js';
import { addPeriod } from '../src/payments/payments.service.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/** Поддельный сервер ЮKassa: платежи в памяти, ответы того же вида, что у API v3. */
function fakeYooKassa() {
  const payments = new Map<string, { id: string; status: string; amount: { value: string; currency: string }; metadata: Record<string, unknown> }>();
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  let seq = 0;
  const impl = vi.fn((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.href;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: u, headers, body });
    const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status }));
    if (u.endsWith('/payments') && init?.method === 'POST') {
      const id = `2f${String(++seq).padStart(10, '0')}-000f-5000-9000-1b2c3d4e5f60`;
      const b = body as { amount: { value: string; currency: string }; metadata: Record<string, unknown> };
      payments.set(id, { id, status: 'pending', amount: b.amount, metadata: b.metadata });
      return json(200, { ...payments.get(id), confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.example/checkout/${id}` } });
    }
    const m = /\/payments\/([^/]+)$/.exec(u);
    if (m && (init?.method ?? 'GET') === 'GET') {
      const p = payments.get(m[1]!);
      return p ? json(200, p) : json(404, { type: 'error', code: 'not_found' });
    }
    if (u.endsWith('/refunds')) return json(200, { id: `rf-${++seq}`, status: 'succeeded' });
    return json(500, {});
  });
  return { impl: impl as unknown as typeof fetch, payments, calls };
}

describe('P7.3 · оплата: заказ, уведомления ЮKassa, права', () => {
  let db: TestDb;
  let t: TestApp;
  let tOff: TestApp;
  let dbOff: TestDb;
  let yoo: ReturnType<typeof fakeYooKassa>;
  let ent: EntitlementsService;
  let phone = 0;

  const otp: OtpSender & { codes: Array<{ phone: string; code: string }> } = {
    codes: [],
    sendCode(p: string, code: string) {
      this.codes.push({ phone: p, code });
      return Promise.resolve();
    },
  };
  const captcha: CaptchaVerifier = { verify: () => Promise.resolve(true) };

  async function login(app: TestApp, d: TestDb): Promise<{ cookie: string; userId: string }> {
    await d.db.delete(schema.otpRequests);
    const p = `+7901${String(2000000 + ++phone)}`;
    await request(app.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: p, captchaToken: 'ok' }).expect(200);
    const { code } = otp.codes.pop()!;
    const res = await request(app.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone: p, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await d.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, p));
    return { cookie, userId: u!.id };
  }
  const order = (app: TestApp, cookie: string, body: object) => request(app.http()).post(`/${API_PREFIX}/orders`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body);
  const notify = (app: TestApp, body: object) => request(app.http()).post(`/${API_PREFIX}/payments/yookassa/notify`).send(body); // без Origin и заголовка CSRF: так приходит от ЮKassa
  const succeeded = (id: string) => ({ type: 'notification', event: 'payment.succeeded', object: { id, status: 'succeeded' } });

  beforeAll(async () => {
    db = await createTestDb();
    dbOff = await createTestDb();
    yoo = fakeYooKassa();
    ent = new EntitlementsService(db.db);
    const cfg = { phoneLogin: true };
    t = await startTestApp({ db: db.db, otpSender: otp, captchaVerifier: captcha, paymentProvider: new YooKassaProvider('1524621', 'test_dummy_secret', yoo.impl, 'https://api.yookassa.test/v3') }, cfg);
    tOff = await startTestApp({ db: dbOff.db, otpSender: otp, captchaVerifier: captcha, paymentProvider: null }, cfg);
  });
  afterAll(async () => {
    await t?.app.close();
    await tOff?.app.close();
    await db?.drop();
    await dbOff?.drop();
  });

  it('P7.3 · addPeriod: месяц и год без «перескока» на конец короткого месяца', () => {
    expect(addPeriod(new Date('2026-01-31T10:00:00Z'), 'MONTH').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addPeriod(new Date('2026-11-09T10:00:00Z'), 'YEAR').toISOString()).toBe('2027-11-09T10:00:00.000Z');
    expect(addPeriod(new Date('2026-12-15T00:00:00Z'), 'MONTH').toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('P7.3 · без ключей ЮKassa оплата отвечает «не подключена», а не падает', async () => {
    const { cookie } = await login(tOff, dbOff);
    const res = await order(tOff, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(503);
    expect(res.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
  });

  it('P7.3 · заказ: цена берётся из таблицы тарифов, платёж создаётся с ключом идемпотентности и Basic-входом', async () => {
    const { cookie, userId } = await login(t, db);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH', amountKop: 1 }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(o).toMatchObject({ userId, kind: 'SUBSCRIPTION', status: 'PENDING', amountKop: 34900, provider: 'yookassa' });
    expect(o!.providerPaymentId).toBeTruthy();
    expect(String(res.body.confirmationUrl)).toContain('https://yoomoney.example/checkout/');
    const call = yoo.calls.at(-1)!;
    expect(call.headers['Idempotence-Key']).toBe(o!.id);
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from('1524621:test_dummy_secret').toString('base64')}`);
    expect((call.body as { amount: { value: string } }).amount.value).toBe('349.00');
  });

  it('P7.3 · неверные заказы отклоняются: свой тариф «Старт», чужая цена, нет входа, нет заголовка CSRF', async () => {
    const { cookie } = await login(t, db);
    await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'FREE', period: 'MONTH' }).expect(400);
    await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'NOPE', period: 'MONTH' }).expect(400);
    await order(t, cookie, { kind: 'PASS', projectId: 'не-моя-сборка' }).expect(404);
    await request(t.http()).post(`/${API_PREFIX}/orders`).set('X-Blokum-CSRF', '1').send({ kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(401);
    await request(t.http()).post(`/${API_PREFIX}/orders`).set('Cookie', cookie).send({ kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(403);
  });

  it('P7.3 · повтор уведомления 5 раз = одна оплата и одна подписка', async () => {
    const { cookie, userId } = await login(t, db);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push((await notify(t, succeeded(o!.providerPaymentId!)).expect(200)).body as { duplicate?: boolean });
    expect(answers.filter((a) => a.duplicate).length).toBe(4);
    const subs = await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ planCode: 'AUTHOR', status: 'ACTIVE', renewMode: 'LINK', paymentMethodRef: null });
    const [paid] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o!.id));
    expect(paid!.status).toBe('PAID');
    expect((await ent.planOf(userId)).code).toBe('AUTHOR');
  });

  it('P7.3 · поддельное уведомление отклонено: платежа нет у провайдера, права не выдаются', async () => {
    const { cookie, userId } = await login(t, db);
    await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PRO', period: 'YEAR' }).expect(201);
    await notify(t, succeeded('2f9999999999-000f-5000-9000-1b2c3d4e5f60')).expect(400);
    await notify(t, { event: 'payment.succeeded', object: {} }).expect(400);
    await notify(t, { nonsense: true }).expect(400);
    expect(await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId))).toHaveLength(0);
    expect((await ent.planOf(userId)).code).toBe('FREE');
  });

  it('P7.3 · уведомление «оплачено» для платежа, который у провайдера ещё не оплачен, ничего не выдаёт', async () => {
    const { cookie, userId } = await login(t, db);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    await notify(t, succeeded(o!.providerPaymentId!)).expect(200); // у провайдера статус pending
    expect((await ent.planOf(userId)).code).toBe('FREE');
    const [still] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o!.id));
    expect(still!.status).toBe('PENDING');
  });

  it('P7.3 · сумма платежа у провайдера не совпала с заказом — отказ', async () => {
    const { cookie } = await login(t, db);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    const p = yoo.payments.get(o!.providerPaymentId!)!;
    p.status = 'succeeded';
    p.amount.value = '1.00';
    await notify(t, succeeded(o!.providerPaymentId!)).expect(400);
    const [same] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o!.id));
    expect(same!.status).toBe('PENDING');
  });

  it('P7.3 · повторная оплата продлевает от конца оплаченного срока', async () => {
    const { cookie, userId } = await login(t, db);
    for (let i = 0; i < 2; i++) {
      const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(201);
      const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
      yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
      await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    }
    const subs = await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(subs).toHaveLength(1);
    expect(subs[0]!.currentPeriodEnd.getTime()).toBe(addPeriod(addPeriod(subs[0]!.currentPeriodStart, 'MONTH'), 'MONTH').getTime());
  });

  it('P7.3 · пропуск «Праздник»: платит владелец сборки, пропуск выдаётся один раз и поднимает лимиты этой сборки', async () => {
    const { cookie, userId } = await login(t, db);
    const [other] = await db.db.insert(schema.users).values({ displayName: 'Чужой' }).returning();
    const [mine] = await db.db.insert(schema.projects).values({ ownerId: userId, title: 'Открытка', slug: 'pass-mine' }).returning();
    const [theirs] = await db.db.insert(schema.projects).values({ ownerId: other!.id, title: 'Чужая', slug: 'pass-theirs' }).returning();
    await order(t, cookie, { kind: 'PASS', projectId: theirs!.id }).expect(404);
    const res = await order(t, cookie, { kind: 'PASS', projectId: mine!.id }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(o!.amountKop).toBe(7900);
    // После оплаты человек возвращается в редактор этой сборки, а не в общий кабинет.
    const returnUrl = ((yoo.calls.at(-1)!.body as { confirmation: { return_url: string } }).confirmation.return_url);
    expect(returnUrl).toBe(`http://localhost:3110/app/projects/${mine!.id}/edit?paid=${o!.id}`);
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    for (let i = 0; i < 3; i++) await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    const grants = await db.db.select().from(schema.entitlements).where(eq(schema.entitlements.sourceOrderId, o!.id));
    expect(grants).toHaveLength(1);
    const view = await ent.limitsOfProject(userId, mine!.id);
    expect(view.plan.code).toBe('PASS');
    expect(view.plan.limits.watermark).toBe(false);
    expect((await ent.limitsOfProject(userId, theirs!.id)).plan.code).toBe('FREE');
  });

  it('P7.3 · возврат: уведомление refund.succeeded закрывает права заказа, повтор ничего не меняет', async () => {
    const { cookie, userId } = await login(t, db);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    expect((await ent.planOf(userId)).code).toBe('AUTHOR');
    const refund = { event: 'refund.succeeded', object: { id: 'rf-1', payment_id: o!.providerPaymentId, status: 'succeeded' } };
    await notify(t, refund).expect(200);
    const again = await notify(t, refund).expect(200);
    expect((again.body as { duplicate?: boolean }).duplicate).toBe(true);
    const [after] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o!.id));
    expect(after!.status).toBe('REFUNDED');
    expect((await ent.planOf(userId)).code).toBe('FREE');
  });

  it('P7.3 · сохранённый способ оплаты не используется и не записывается без отдельного согласия', async () => {
    const { cookie, userId } = await login(t, db);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'YEAR' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(JSON.stringify(yoo.calls.at(-1)!.body)).not.toMatch(/save_payment_method|payment_method_id/);
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    const [sub] = await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(sub).toMatchObject({ renewMode: 'LINK', paymentMethodRef: null, autoRenewConsentId: null });
  });

  it('P7.4 · пробный период: 3 дня без карты, один раз на человека, потом «Старт» и никаких списаний', async () => {
    const { cookie, userId } = await login(t, db);
    const trial = (planCode: string) => request(t.http()).post(`/${API_PREFIX}/billing/trial`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ planCode });
    await trial('FREE').expect(400);
    await trial('PASS').expect(400);
    await trial('PRO').expect(400);
    const res = await trial('AUTHOR').expect(200);
    expect(res.body).toMatchObject({ plan: { code: 'AUTHOR' }, trialUsed: true, subscription: { status: 'TRIAL', trial: true, renewMode: 'LINK' } });
    const [sub] = await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(sub!.currentPeriodEnd.getTime() - sub!.currentPeriodStart.getTime()).toBe(3 * 86_400_000);
    expect(sub).toMatchObject({ paymentMethodRef: null, autoRenewConsentId: null });
    await trial('PLUS').expect(409); // уже действует платный тариф
    // после окончания — «Старт», второй пробный период недоступен, заказов и списаний нет
    const after = new Date(sub!.currentPeriodEnd.getTime() + 1000);
    expect((await ent.planOf(userId, after)).code).toBe('FREE');
    await db.db.update(schema.subscriptions).set({ currentPeriodStart: new Date(Date.now() - 5 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.subscriptions.id, sub!.id));
    await trial('PLUS').expect(409);
    expect(await db.db.select().from(schema.orders).where(eq(schema.orders.userId, userId))).toHaveLength(0);
    const state = await request(t.http()).get(`/${API_PREFIX}/billing/me`).set('Cookie', cookie).expect(200);
    expect(state.body).toMatchObject({ plan: { code: 'FREE' }, trialUsed: true });
  });

  it('P7.4 · пять одновременных заявок на пробный период создают ровно один', async () => {
    const { cookie, userId } = await login(t, db);
    const results = await Promise.all(Array.from({ length: 5 }, () => request(t.http()).post(`/${API_PREFIX}/billing/trial`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ planCode: 'PLUS' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId))).toHaveLength(1);
  });
});
