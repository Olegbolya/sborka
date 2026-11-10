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

  /** Заказ на допродажу, оплаченный в поддельной ЮKassa; возвращает заказ. */
  async function buyAddon(cookie: string, body: object): Promise<typeof schema.orders.$inferSelect> {
    const res = await order(t, cookie, { kind: 'ADDON', ...body }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    return o!;
  }
  const subscribe = (userId: string, planCode = 'AUTHOR') =>
    db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 90 * 86_400_000) });

  it('P7.5 · каталог допродаж: цены из таблицы, для «Старта» открыта только покупка «Старта», остальные объясняют, чего не хватает', async () => {
    const { cookie } = await login(t, db);
    const res = await request(t.http()).get(`/${API_PREFIX}/billing/addons`).set('Cookie', cookie).expect(200);
    const list = res.body.addons as Array<{ code: string; priceRub: number; available: boolean; reason: string | null; needsProject: boolean }>;
    expect(list.map((a) => [a.code, a.priceRub])).toEqual([['PASS_COMPLETIONS_500', 99], ['PASS_EXTEND_30', 99], ['COMPLETIONS_1000', 149], ['STORAGE_10GB', 149], ['FREE_EXTRAS', 99]]);
    expect(list.filter((a) => a.available).map((a) => a.code)).toEqual(['FREE_EXTRAS']);
    expect(list.find((a) => a.code === 'STORAGE_10GB')!.reason).toMatch(/платной подписки/);
    expect(list.find((a) => a.code === 'PASS_EXTEND_30')!.needsProject).toBe(true);
    await request(t.http()).get(`/${API_PREFIX}/billing/addons`).expect(401);
  });

  it('P7.5 · «+5 тем и +100 правил»: только для «Старта», выдаётся один раз при повторе уведомления, возврат отнимает', async () => {
    const { cookie, userId } = await login(t, db);
    const before = await ent.limitsOf(userId);
    const res = await order(t, cookie, { kind: 'ADDON', addon: 'FREE_EXTRAS' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(o!.amountKop).toBe(9900);
    expect(o!.kind).toBe('ADDON');
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    for (let i = 0; i < 5; i++) await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    const after = await ent.limitsOf(userId);
    expect(after.ownThemes).toBe((before.ownThemes ?? 0) + 5);
    expect(after.rulesPerProject).toBe(before.rulesPerProject + 100);
    expect(after.watermark).toBe(true);
    await notify(t, { event: 'refund.succeeded', object: { id: 'rf-x', payment_id: o!.providerPaymentId, status: 'succeeded' } }).expect(200);
    expect((await ent.limitsOf(userId)).rulesPerProject).toBe(before.rulesPerProject);
    // На подписке эта покупка не нужна.
    await subscribe(userId);
    await order(t, cookie, { kind: 'ADDON', addon: 'FREE_EXTRAS' }).expect(409);
  });

  it('P7.5 · «+10 ГБ»: платная подписка, покупки складываются, срок — месяц; на «Старте» отказ', async () => {
    const { cookie, userId } = await login(t, db);
    const refused = await order(t, cookie, { kind: 'ADDON', addon: 'STORAGE_10GB' }).expect(409);
    expect(refused.body.error.code).toBe('ADDON_NOT_APPLICABLE');
    await subscribe(userId);
    const base = (await ent.limitsOf(userId)).storageBytes;
    await buyAddon(cookie, { addon: 'STORAGE_10GB' });
    await buyAddon(cookie, { addon: 'STORAGE_10GB' });
    expect((await ent.limitsOf(userId)).storageBytes).toBe(base + 20 * 1024 ** 3);
    const rows = await db.db.select().from(schema.entitlements).where(eq(schema.entitlements.userId, userId));
    const until = rows.find((r) => r.feature === 'EXTRA_STORAGE')!.validTo!.getTime();
    expect(until - Date.now()).toBeGreaterThan(27 * 86_400_000);
    expect(until - Date.now()).toBeLessThan(32 * 86_400_000);
    // Через месяц купленное место не действует.
    expect((await ent.limitsOf(userId, new Date(Date.now() + 40 * 86_400_000))).storageBytes).toBe(base);
  });

  it('P7.5 · «Праздник»: +500 прохождений — только к сборке с действующим пропуском и до его конца; продление на 30 дней', async () => {
    const { cookie, userId } = await login(t, db);
    const [project] = await db.db.insert(schema.projects).values({ ownerId: userId, title: 'Праздник', slug: 'addon-pass' }).returning();
    const noPass = await order(t, cookie, { kind: 'ADDON', addon: 'PASS_COMPLETIONS_500', projectId: project!.id }).expect(409);
    expect(noPass.body.error.message).toMatch(/нет пропуска/);
    await order(t, cookie, { kind: 'ADDON', addon: 'PASS_COMPLETIONS_500' }).expect(400);
    const [other] = await db.db.insert(schema.users).values({ displayName: 'Чужой' }).returning();
    const [theirs] = await db.db.insert(schema.projects).values({ ownerId: other!.id, title: 'Чужая', slug: 'addon-theirs' }).returning();
    await order(t, cookie, { kind: 'ADDON', addon: 'PASS_EXTEND_30', projectId: theirs!.id }).expect(404);
    const passOrder = await order(t, cookie, { kind: 'PASS', projectId: project!.id }).expect(201);
    const [po] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, passOrder.body.orderId as string));
    yoo.payments.get(po!.providerPaymentId!)!.status = 'succeeded';
    await notify(t, succeeded(po!.providerPaymentId!)).expect(200);
    const pass = (await ent.passOf(project!.id))!;
    await buyAddon(cookie, { addon: 'PASS_COMPLETIONS_500', projectId: project!.id });
    const extra = (await db.db.select().from(schema.entitlements).where(eq(schema.entitlements.projectId, project!.id))).find((r) => r.feature === 'EXTRA_COMPLETIONS')!;
    expect(extra.quantity).toBe(500);
    expect(extra.validTo!.getTime()).toBe(pass.to.getTime());
    await buyAddon(cookie, { addon: 'PASS_EXTEND_30', projectId: project!.id });
    expect((await ent.passOf(project!.id))!.to.getTime()).toBe(pass.to.getTime() + 30 * 86_400_000);
  });

  // ── P7.5 · промокоды ────────────────────────────────────────────────────────
  let promoSeq = 0;
  const makePromo = async (over: Partial<typeof schema.promoCodes.$inferInsert> = {}) => {
    const [row] = await db.db
      .insert(schema.promoCodes)
      .values({ code: `TEST${++promoSeq}X${Date.now() % 100000}`, kind: 'PERCENT', value: 20, appliesTo: ['SUBSCRIPTION', 'PASS', 'ADDON'], ...over })
      .returning();
    return row!;
  };
  const promoRow = async (id: string) => (await db.db.select().from(schema.promoCodes).where(eq(schema.promoCodes.id, id)))[0]!;
  const pay = async (orderId: string) => {
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
    await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    return o!;
  };

  it('P7.5 · промокод «процент»: цена пересчитана, провайдеру уходит сумма со скидкой, использование записано; в заказе видны цена и скидка', async () => {
    const { cookie } = await login(t, db);
    const promo = await makePromo({ kind: 'PERCENT', value: 20 });
    const quote = await request(t.http()).post(`/${API_PREFIX}/promo/check`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo: promo.code.toLowerCase() }).expect(200);
    expect(quote.body).toEqual({ listKop: 19900, discountKop: 3980, finalKop: 15920, code: promo.code });
    // Без названия покупки проверяется только сам код (страница «Тариф и оплата»).
    const described = await request(t.http()).post(`/${API_PREFIX}/promo/check`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ promo: promo.code }).expect(200);
    expect(described.body).toEqual({ code: promo.code, kind: 'PERCENT', value: 20, appliesTo: ['SUBSCRIPTION', 'PASS', 'ADDON'] });
    await request(t.http()).post(`/${API_PREFIX}/promo/check`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ promo: 'NETTAKOGO' }).expect(400);
    // Проверка цены ничего не расходует.
    expect((await promoRow(promo.id)).activations).toBe(0);
    const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo: promo.code }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(o!.amountKop).toBe(15920);
    expect(o!.item).toMatchObject({ promo: promo.code, listPriceKop: 19900, discountKop: 3980 });
    expect(yoo.payments.get(o!.providerPaymentId!)!.amount.value).toBe('159.20');
    expect((await promoRow(promo.id)).activations).toBe(1);
    await pay(o!.id);
    // Повторное уведомление не добавляет использований.
    await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
    expect((await promoRow(promo.id)).activations).toBe(1);
  });

  it('P7.5 · промокод «фиксированная скидка»: рубли вычитаются, но к оплате остаётся не меньше 1 ₽', async () => {
    const { cookie, userId } = await login(t, db);
    const [project] = await db.db.insert(schema.projects).values({ ownerId: userId, title: 'Скидка', slug: 'promo-fixed' }).returning();
    const fixed = await makePromo({ kind: 'FIXED', value: 30 });
    const big = await makePromo({ kind: 'FIXED', value: 500 });
    const a = await order(t, cookie, { kind: 'PASS', projectId: project!.id, promo: fixed.code }).expect(201);
    expect((await db.db.select().from(schema.orders).where(eq(schema.orders.id, a.body.orderId as string)))[0]!.amountKop).toBe(4900);
    const b = await order(t, cookie, { kind: 'PASS', projectId: project!.id, promo: big.code }).expect(201);
    expect((await db.db.select().from(schema.orders).where(eq(schema.orders.id, b.body.orderId as string)))[0]!.amountKop).toBe(100);
  });

  it('P7.5 · бесплатный «Праздник»: заказ оплачен сразу без платёжного сервиса, пропуск выдан один раз; промокод — только к «Празднику»', async () => {
    const { cookie, userId } = await login(tOff, dbOff);
    const [project] = await dbOff.db.insert(schema.projects).values({ ownerId: userId, title: 'Подарок', slug: 'promo-free' }).returning();
    const [free] = await dbOff.db.insert(schema.promoCodes).values({ code: 'PODAROK1', kind: 'FREE_PASS', appliesTo: ['PASS'], maxActivations: 1 }).returning();
    // Подписку по такому коду не купить.
    const wrong = await order(tOff, cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo: 'PODAROK1' });
    expect([400, 503]).toContain(wrong.status);
    expect((await dbOff.db.select().from(schema.promoCodes).where(eq(schema.promoCodes.id, free!.id)))[0]!.activations).toBe(0);
    const res = await order(tOff, cookie, { kind: 'PASS', projectId: project!.id, promo: 'podarok1' }).expect(201);
    expect(res.body.confirmationUrl).toBe(`http://localhost:3110/app/projects/${project!.id}/edit?paid=${res.body.orderId as string}`);
    const [o] = await dbOff.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(o).toMatchObject({ status: 'PAID', amountKop: 0, provider: 'promo' });
    const grants = await dbOff.db.select().from(schema.entitlements).where(eq(schema.entitlements.sourceOrderId, o!.id));
    expect(grants).toHaveLength(1);
    expect(await new EntitlementsService(dbOff.db).passOf(project!.id)).not.toBeNull();
    // Единственное использование потрачено: второй человек получает отказ.
    const second = await login(tOff, dbOff);
    const [other] = await dbOff.db.insert(schema.projects).values({ ownerId: second.userId, title: 'Ещё', slug: 'promo-free-2' }).returning();
    const refused = await order(tOff, second.cookie, { kind: 'PASS', projectId: other!.id, promo: 'PODAROK1' }).expect(400);
    expect(refused.body.error.code).toBe('PROMO_EXHAUSTED');
  });

  it('P7.5 · промокод не работает: нет такого, выключен, ещё не начался, закончился, не к этой покупке, лимит исчерпан, второй раз тем же человеком', async () => {
    const { cookie, userId } = await login(t, db);
    const day = 86_400_000;
    const code = async (over: Partial<typeof schema.promoCodes.$inferInsert>) => (await makePromo(over)).code;
    const tryIt = async (promo: string, expectCode: string) => {
      const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo }).expect(400);
      expect(res.body.error.code).toBe(expectCode);
    };
    await tryIt('NETTAKOGO', 'PROMO_INVALID');
    await tryIt(await code({ active: false }), 'PROMO_INVALID');
    await tryIt(await code({ validFrom: new Date(Date.now() + day) }), 'PROMO_NOT_STARTED');
    await tryIt(await code({ validTo: new Date(Date.now() - day) }), 'PROMO_EXPIRED');
    await tryIt(await code({ appliesTo: ['PASS'] }), 'PROMO_NOT_APPLICABLE');
    await tryIt(await code({ maxActivations: 1, activations: 1 }), 'PROMO_EXHAUSTED');
    // Один человек — одно использование: после оплаты тот же код отклоняется.
    const once = await makePromo({});
    const first = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo: once.code }).expect(201);
    await pay(first.body.orderId as string);
    await tryIt(once.code, 'PROMO_USED');
    expect((await promoRow(once.id)).activations).toBe(1);
    // Заказ без промокода по-прежнему создаётся по полной цене.
    const plain = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode: 'PLUS', period: 'MONTH' }).expect(201);
    expect((await db.db.select().from(schema.orders).where(eq(schema.orders.id, plain.body.orderId as string)))[0]!.amountKop).toBe(34900);
    expect(userId).toBeTruthy();
  });

  it('P7.5 · использование не пропадает зря: не оплатил — повторить тем же кодом можно, платёж отменён — использование возвращается', async () => {
    const { cookie } = await login(t, db);
    const limited = await makePromo({ maxActivations: 1 });
    const body = { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo: limited.code };
    const first = await order(t, cookie, body).expect(201);
    expect((await promoRow(limited.id)).activations).toBe(1);
    // Человек вернулся, не оплатив, и нажал снова: то же использование, а не второе.
    const again = await order(t, cookie, body).expect(201);
    expect((await promoRow(limited.id)).activations).toBe(1);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, again.body.orderId as string));
    yoo.payments.get(o!.providerPaymentId!)!.status = 'canceled';
    await notify(t, { type: 'notification', event: 'payment.canceled', object: { id: o!.providerPaymentId, status: 'canceled' } }).expect(200);
    expect((await promoRow(limited.id)).activations).toBe(0);
    expect(first.body.orderId).not.toBe(again.body.orderId);
  });

  it('P7.5 · пять человек одновременно берут последнее использование — достаётся одному', async () => {
    const people: Array<{ cookie: string; userId: string }> = [];
    for (let i = 0; i < 5; i++) people.push(await login(t, db));
    const last = await makePromo({ maxActivations: 1 });
    const results = await Promise.all(people.map((p) => order(t, p.cookie, { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH', promo: last.code })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
    expect((await promoRow(last.id)).activations).toBe(1);
  });

  it('P7.5 · админка промокодов: только администратор; проверка полей; повтор кода отклонён; выключение и лимит правятся, вид скидки — нет; всё в журнале', async () => {
    const user = await login(t, db);
    const adminSession = await login(t, db);
    await db.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.id, adminSession.userId));
    const api = (method: 'get' | 'post' | 'patch', path: string, cookie: string, body?: object) => {
      const r = request(t.http())[method](`/${API_PREFIX}/admin/promo-codes${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
      return body ? r.send(body) : r;
    };
    await api('get', '', user.cookie).expect(403);
    await api('post', '', user.cookie, { code: 'ZIMA2027', kind: 'PERCENT', value: 10 }).expect(403);
    await api('post', '', adminSession.cookie, { code: 'ab', kind: 'PERCENT', value: 10 }).expect(400);
    await api('post', '', adminSession.cookie, { code: 'ZIMA2027', kind: 'PERCENT', value: 100 }).expect(400);
    await api('post', '', adminSession.cookie, { code: 'ZIMA2027', kind: 'FIXED', value: 0 }).expect(400);
    await api('post', '', adminSession.cookie, { code: 'ZIMA2027', kind: 'PERCENT', value: 10, validFrom: '2027-01-10', validTo: '2027-01-01' }).expect(400);
    const created = (await api('post', '', adminSession.cookie, { code: 'zima2027', kind: 'PERCENT', value: 15, maxActivations: 100, validTo: '2027-03-01T00:00:00Z', note: 'Зимняя акция' }).expect(201)).body as { id: string; code: string; appliesTo: string[] };
    expect(created.code).toBe('ZIMA2027');
    expect(created.appliesTo).toEqual(['SUBSCRIPTION', 'PASS', 'ADDON']);
    expect((await api('post', '', adminSession.cookie, { code: 'ZIMA2027', kind: 'PERCENT', value: 10 }).expect(409)).body.error.code).toBe('PROMO_EXISTS');
    const free = (await api('post', '', adminSession.cookie, { code: 'DAROM-1', kind: 'FREE_PASS', appliesTo: ['SUBSCRIPTION'] }).expect(201)).body as { appliesTo: string[] };
    expect(free.appliesTo).toEqual(['PASS']);
    const changed = (await api('patch', `/${created.id}`, adminSession.cookie, { active: false, maxActivations: 50, kind: 'FIXED', value: 999 }).expect(200)).body as { active: boolean; maxActivations: number; kind: string; value: number };
    expect(changed).toMatchObject({ active: false, maxActivations: 50, kind: 'PERCENT', value: 15 });
    const list = (await api('get', '', adminSession.cookie).expect(200)).body.codes as Array<{ code: string }>;
    expect(list.map((c) => c.code)).toEqual(expect.arrayContaining(['ZIMA2027', 'DAROM-1']));
    const logged = await db.db.select({ action: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.targetId, created.id));
    expect(logged.map((l) => l.action).sort()).toEqual(['PROMO_CHANGED', 'PROMO_CREATED']);
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

  // ── P7.7 · админка платежей, возвраты, доход самозанятого ───────────────────
  describe('P7.7 · админка платежей', () => {
    const adm = (method: 'get' | 'post' | 'patch' | 'put', path: string, cookie: string, body?: object) => {
      const r = request(t.http())[method](`/${API_PREFIX}/admin/payments${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
      return body ? r.send(body) : r;
    };
    interface Income { year: number; limitKop: number; personKop: number; businessKop: number; totalKop: number; taxKop: number; percent: number; reached: number[] }
    const income = async (cookie: string): Promise<Income> => (await adm('get', '/income', cookie).expect(200)).body as Income;
    const pay = async (cookie: string, planCode = 'AUTHOR'): Promise<{ id: string; providerPaymentId: string; amountKop: number }> => {
      const res = await order(t, cookie, { kind: 'SUBSCRIPTION', planCode, period: 'MONTH' }).expect(201);
      const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
      yoo.payments.get(o!.providerPaymentId!)!.status = 'succeeded';
      await notify(t, succeeded(o!.providerPaymentId!)).expect(200);
      return { id: o!.id, providerPaymentId: o!.providerPaymentId!, amountKop: o!.amountKop };
    };
    const adminLogin = async (): Promise<{ cookie: string; userId: string }> => {
      const a = await login(t, db);
      await db.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.id, a.userId));
      return a;
    };
    const noticesOf = async (userId: string) => db.db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

    it('AD-05 · админка платежей только для администратора, поля проверяются', async () => {
      const user = await login(t, db);
      const admin = await adminLogin();
      await adm('get', '/income', user.cookie).expect(403);
      await adm('get', '/orders', user.cookie).expect(403);
      await adm('put', '/income-limit', user.cookie, { rub: 5000 }).expect(403);
      await adm('post', '/grants', user.cookie, { userId: user.userId, kind: 'SUBSCRIPTION', planCode: 'PLUS', months: 1, reason: 'тест' }).expect(403);
      await adm('put', '/income-limit', admin.cookie, { rub: 10 }).expect(400);
      await adm('put', '/income-limit', admin.cookie, { rub: 'много' }).expect(400);
      await adm('get', '/orders', admin.cookie).expect(200);
    });

    it('AD-12 · доход с 1 января: физлица и юрлица/ИП отдельно, налог 4 % и 6 %; смена плательщика требует ИНН; возврат уменьшает доход', async () => {
      const admin = await adminLogin();
      const before = await income(admin.cookie);
      const payer = await login(t, db);
      const o = await pay(payer.cookie);
      const afterPay = await income(admin.cookie);
      expect(afterPay.personKop - before.personKop).toBe(o.amountKop);
      expect(afterPay.businessKop).toBe(before.businessKop);
      expect(afterPay.year).toBe(new Date().getUTCFullYear());
      await adm('patch', `/orders/${o.id}/payer`, admin.cookie, { payerType: 'BUSINESS' }).expect(400);
      await adm('patch', `/orders/${o.id}/payer`, admin.cookie, { payerType: 'BUSINESS', payerInn: '123' }).expect(400);
      await adm('patch', `/orders/${o.id}/payer`, admin.cookie, { payerType: 'BUSINESS', payerInn: '7707083893' }).expect(200);
      const asBusiness = await income(admin.cookie);
      expect(asBusiness.businessKop - before.businessKop).toBe(o.amountKop);
      expect(asBusiness.personKop).toBe(before.personKop);
      expect(asBusiness.totalKop).toBe(afterPay.totalKop);
      expect(asBusiness.taxKop - afterPay.taxKop).toBe(Math.round(o.amountKop * 0.06) - Math.round(o.amountKop * 0.04));
      // возврат: провайдеру уходит запрос, доход уменьшается только когда провайдер подтвердил
      await adm('post', `/orders/${o.id}/refund`, admin.cookie, { reason: '' }).expect(400);
      const refund = await adm('post', `/orders/${o.id}/refund`, admin.cookie, { reason: 'Просьба покупателя' }).expect(201);
      expect((refund.body as { status: string }).status).toBe('succeeded');
      expect((await income(admin.cookie)).totalKop).toBe(asBusiness.totalKop);
      await notify(t, { event: 'refund.succeeded', object: { id: 'rf-x', payment_id: o.providerPaymentId, status: 'succeeded' } }).expect(200);
      const afterRefund = await income(admin.cookie);
      expect(afterRefund.totalKop).toBe(before.totalKop);
      await adm('post', `/orders/${o.id}/refund`, admin.cookie, { reason: 'Ещё раз' }).expect(409);
      const log = await db.db.select({ action: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.targetId, o.id));
      expect(log.map((l) => l.action).sort()).toEqual(['ORDER_PAYER_CHANGED', 'ORDER_REFUND_REQUESTED']);
    });

    it('AD-12 · предупреждения администраторам при 80 % и 95 % лимита: каждое один раз в год (проверено подменой сумм)', async () => {
      const admin = await adminLogin();
      const other = await adminLogin();
      const base = await income(admin.cookie);
      // лимит выставлен так, что один платёж «Автора» выводит доход на ~85 %: ниже 95 %, выше 80 %
      const limit85 = Math.ceil((base.totalKop / 100 + 199) / 0.85);
      await adm('put', '/income-limit', admin.cookie, { rub: limit85 * 20 }).expect(200);
      expect((await income(admin.cookie)).reached).toEqual([]);
      const kinds = async (u: string) => (await noticesOf(u)).map((n) => n.kind).filter((k) => k.startsWith('npd-'));
      expect(await kinds(admin.userId)).toEqual([]);
      await adm('put', '/income-limit', admin.cookie, { rub: limit85 }).expect(200);
      const year = new Date().getUTCFullYear();
      const first = await income(admin.cookie);
      expect(first.percent).toBeLessThan(95);
      expect(first.reached).toEqual(first.percent >= 80 ? [80] : []);
      const payer = await login(t, db);
      const o = await pay(payer.cookie);
      const view = await income(admin.cookie);
      expect(view.reached).toEqual([80]);
      expect(await kinds(admin.userId)).toEqual([`npd-80:${year}`]);
      expect(await kinds(other.userId)).toEqual([`npd-80:${year}`]);
      // ещё одна оплата того же порога не повторяет предупреждение
      await pay((await login(t, db)).cookie);
      expect((await kinds(admin.userId)).filter((k) => k === `npd-80:${year}`)).toHaveLength(1);
      // лимит уменьшили так, что доход перешёл 95 %
      const limit96 = Math.floor((await income(admin.cookie)).totalKop / 100 / 0.96);
      await adm('put', '/income-limit', admin.cookie, { rub: limit96 }).expect(200);
      expect((await income(admin.cookie)).reached).toEqual([80, 95]);
      expect((await kinds(admin.userId)).sort()).toEqual([`npd-80:${year}`, `npd-95:${year}`]);
      await adm('put', '/income-limit', admin.cookie, { rub: limit96 }).expect(200);
      expect(await kinds(admin.userId)).toHaveLength(2);
      await adm('put', '/income-limit', admin.cookie, { rub: 2_400_000 }).expect(200);
      expect(o.amountKop).toBeGreaterThan(0);
    });

    it('AD-05 · ручное начисление: тариф на месяцы и «Праздник» для сборки; причина обязательна; не доход; в списке заказов и в журнале', async () => {
      const admin = await adminLogin();
      const user = await login(t, db);
      const owner = await login(t, db); // «Праздник» виден без подписки: у получателя тарифа PLUS он был бы ниже тарифа
      const [mine] = await db.db.insert(schema.projects).values({ ownerId: owner.userId, title: 'Подарок', slug: 'manual-grant' }).returning();
      const before = await income(admin.cookie);
      const g = { userId: user.userId, kind: 'SUBSCRIPTION', planCode: 'PLUS', months: 2, reason: 'Компенсация за сбой' };
      await adm('post', '/grants', admin.cookie, { ...g, reason: '' }).expect(400);
      await adm('post', '/grants', admin.cookie, { ...g, months: 0 }).expect(400);
      await adm('post', '/grants', admin.cookie, { ...g, planCode: 'FREE' }).expect(400);
      await adm('post', '/grants', admin.cookie, { ...g, userId: '00000000-0000-0000-0000-000000000000' }).expect(404);
      const done = (await adm('post', '/grants', admin.cookie, g).expect(201)).body as { orderId: string };
      expect((await ent.planOf(user.userId)).code).toBe('PLUS');
      const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, done.orderId));
      expect(o).toMatchObject({ amountKop: 0, status: 'PAID', provider: 'manual' });
      const passOrder = (await adm('post', '/grants', admin.cookie, { userId: owner.userId, kind: 'PASS', projectId: mine!.id, reason: 'Подарок на праздник' }).expect(201)).body as { orderId: string };
      expect((await ent.limitsOfProject(owner.userId, mine!.id)).plan.code).toBe('PASS');
      const [foreign] = await db.db.insert(schema.projects).values({ ownerId: admin.userId, title: 'Не его', slug: 'manual-foreign' }).returning();
      await adm('post', '/grants', admin.cookie, { userId: owner.userId, kind: 'PASS', projectId: foreign!.id, reason: 'Чужая сборка' }).expect(404);
      expect((await income(admin.cookie)).totalKop).toBe(before.totalKop);
      const list = (await adm('get', `/orders?q=${passOrder.orderId.slice(0, 8)}`, admin.cookie).expect(200)).body as { orders: Array<{ id: string; provider: string; user: { id: string } | null }>; total: number };
      expect(list.orders.map((x) => x.id)).toContain(passOrder.orderId);
      expect(list.orders.find((x) => x.id === passOrder.orderId)).toMatchObject({ provider: 'manual', user: { id: owner.userId } });
      const logged = await db.db.select({ action: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.targetId, owner.userId));
      expect(logged.filter((l) => l.action === 'MANUAL_GRANT')).toHaveLength(1);
      const paidOnly = (await adm('get', '/orders?status=PAID&kind=PASS', admin.cookie).expect(200)).body as { orders: Array<{ status: string; kind: string }> };
      expect(paidOnly.orders.every((x) => x.status === 'PAID' && x.kind === 'PASS')).toBe(true);
    });
  });
});
