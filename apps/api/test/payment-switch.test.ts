import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { ApiConfig } from '../src/config.js';
import { paymentProviderChoice } from '../src/config.js';
import { PaymentsModule } from '../src/payments/payments.module.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { RobokassaProvider } from '../src/payments/robokassa.provider.js';
import { YooKassaProvider } from '../src/payments/yookassa.provider.js';
import { PAYMENT_PROVIDER, PAYMENT_PROVIDERS } from '../src/tokens.js';
import { OPTS, fakeRobokassa, fakeYooKassa, md5 } from './fake-payments.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/** ADR-113 · два провайдера сразу: новые оплаты идут через выбранного, старые заказы обслуживает тот, кто принял оплату. */
describe('P7.3 · переключение платёжного провайдера (ADR-113)', () => {
  let db: TestDb;
  let t: TestApp;
  let yoo: ReturnType<typeof fakeYooKassa>;
  let rk: ReturnType<typeof fakeRobokassa>;
  let phone = 0;
  const otp: OtpSender & { codes: Array<{ phone: string; code: string }> } = {
    codes: [],
    sendCode(p: string, code: string) {
      this.codes.push({ phone: p, code });
      return Promise.resolve();
    },
  };
  const captcha: CaptchaVerifier = { verify: () => Promise.resolve(true) };

  async function login(): Promise<{ cookie: string; userId: string }> {
    await db.db.delete(schema.otpRequests);
    const p = `+7903${String(4000000 + ++phone)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: p, captchaToken: 'ok' }).expect(200);
    const { code } = otp.codes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone: p, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, p));
    return { cookie, userId: u!.id };
  }

  /** Заказ, оплаченный через ЮKassa до переключения: строка заказа и платёж в поддельной ЮKassa. */
  async function oldYooKassaOrder(userId: string, status: 'PENDING' | 'PAID'): Promise<typeof schema.orders.$inferSelect> {
    const paymentId = `2f${String(Date.now()).slice(-10)}-000f-5000-9000-${String(++phone).padStart(12, '0')}`;
    const [o] = await db.db
      .insert(schema.orders)
      .values({ userId, kind: 'SUBSCRIPTION', item: { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }, amountKop: 19900, provider: 'yookassa', providerPaymentId: paymentId, status, ...(status === 'PAID' ? { paidAt: new Date() } : {}) })
      .returning();
    yoo.payments.set(paymentId, { id: paymentId, status: status === 'PAID' ? 'succeeded' : 'pending', amount: { value: '199.00', currency: 'RUB' }, metadata: { orderId: o!.id } });
    return o!;
  }

  beforeAll(async () => {
    db = await createTestDb();
    yoo = fakeYooKassa();
    rk = fakeRobokassa();
    const robokassa = new RobokassaProvider(OPTS, rk.impl);
    const yookassa = new YooKassaProvider('1524621', 'test_dummy_secret', yoo.impl, 'https://api.yookassa.test/v3');
    // Robokassa первой — она принимает новые оплаты; ЮKassa осталась подключённой ради старых заказов.
    t = await startTestApp({ db: db.db, otpSender: otp, captchaVerifier: captcha, paymentProvider: [robokassa, yookassa] }, { phoneLogin: true });
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('P7.3 · ADR-113: после переключения новый заказ создаётся у Robokassa, ЮKassa не вызывается', async () => {
    const { cookie } = await login();
    const before = yoo.calls.length;
    const res = await request(t.http()).post(`/${API_PREFIX}/orders`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    expect(o!.provider).toBe('robokassa');
    expect(new URL(String(res.body.confirmationUrl)).host).toBe('auth.robokassa.ru');
    expect(yoo.calls.length).toBe(before);
  });

  it('P7.3 · ADR-113: запоздавшее уведомление ЮKassa по старому заказу засчитывает оплату', async () => {
    const { userId } = await login();
    const o = await oldYooKassaOrder(userId, 'PENDING');
    yoo.payments.get(o.providerPaymentId!)!.status = 'succeeded';
    await request(t.http()).post(`/${API_PREFIX}/payments/yookassa/notify`).send({ event: 'payment.succeeded', object: { id: o.providerPaymentId } }).expect(200);
    const [after] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after!.status).toBe('PAID');
    const subs = await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(subs).toHaveLength(1);
  });

  it('P7.3 · ADR-113: возврат старого заказа уходит в ЮKassa, нового — в Robokassa', async () => {
    const { userId, cookie } = await login();
    const payments = t.app.get(PaymentsService);
    const old = await oldYooKassaOrder(userId, 'PAID');
    const refundsBefore = rk.refunds.length;
    const r1 = await payments.refund(old.id);
    expect(r1.status).toBe('succeeded');
    const yooRefund = yoo.calls.at(-1)!;
    expect(yooRefund.url).toBe('https://api.yookassa.test/v3/refunds');
    expect(yooRefund.body).toMatchObject({ payment_id: old.providerPaymentId, amount: { value: '199.00' } });
    expect(rk.refunds.length).toBe(refundsBefore);

    const res = await request(t.http()).post(`/${API_PREFIX}/orders`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }).expect(201);
    const [fresh] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    const sum = (fresh!.amountKop / 100).toFixed(2);
    rk.ops.set(fresh!.providerPaymentId!, { code: 100, outSum: sum, order: fresh!.id });
    const sig = md5(`${sum}:${fresh!.providerPaymentId!}:${OPTS.password2}:Shp_order=${fresh!.id}`).toUpperCase();
    await request(t.http()).post(`/${API_PREFIX}/payments/robokassa/result`).type('form').send({ OutSum: sum, InvId: fresh!.providerPaymentId!, Shp_order: fresh!.id, SignatureValue: sig }).expect(200);
    const yooCalls = yoo.calls.length;
    await payments.refund(fresh!.id);
    expect(rk.refunds.at(-1)).toEqual({ opKey: `key-${fresh!.providerPaymentId!}`, sum: fresh!.amountKop / 100, auth: 'ok' });
    expect(yoo.calls.length).toBe(yooCalls);
  });

  it('P7.3 · ADR-113: возврат заказа провайдера, чьих ключей нет на сервере, отклоняется понятным сообщением', async () => {
    const { userId } = await login();
    const [o] = await db.db.insert(schema.orders).values({ userId, kind: 'SUBSCRIPTION', item: { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }, amountKop: 19900, provider: 'cloudpayments', providerPaymentId: 'cp-1', status: 'PAID', paidAt: new Date() }).returning();
    await expect(t.app.get(PaymentsService).refund(o!.id)).rejects.toMatchObject({ status: 503, response: { error: { code: 'PAYMENTS_UNAVAILABLE', message: expect.stringContaining('другой платёжный сервис') as unknown } } });
  });

  it('P7.3 · ADR-113: PAYMENT_PROVIDER — пусто, верное имя, неизвестное имя, провайдер без ключей', () => {
    const yooKeys = { YOOKASSA_SHOP_ID: '1', YOOKASSA_SECRET_KEY: 'k' };
    const rkKeys = { ROBOKASSA_LOGIN: 'l', ROBOKASSA_PASSWORD1: 'a', ROBOKASSA_PASSWORD2: 'b', ROBOKASSA_PASSWORD3: 'c' };
    expect(paymentProviderChoice({})).toEqual({});
    expect(paymentProviderChoice({ PAYMENT_PROVIDER: '  ' })).toEqual({});
    expect(paymentProviderChoice({ PAYMENT_PROVIDER: ' Robokassa ', ...rkKeys })).toEqual({ paymentProvider: 'robokassa' });
    expect(paymentProviderChoice({ PAYMENT_PROVIDER: 'yookassa', ...yooKeys })).toEqual({ paymentProvider: 'yookassa' });
    expect(() => paymentProviderChoice({ PAYMENT_PROVIDER: 'robokasa', ...rkKeys })).toThrow('Неизвестный платёжный провайдер');
    expect(() => paymentProviderChoice({ PAYMENT_PROVIDER: 'robokassa', ...yooKeys })).toThrow('ключи этого провайдера не заданы');
    expect(() => paymentProviderChoice({ PAYMENT_PROVIDER: 'yookassa', ...rkKeys, YOOKASSA_SHOP_ID: '1' })).toThrow('ключи этого провайдера не заданы');
  });

  it('P7.3 · ADR-113: модуль подключает оба провайдера, новые оплаты — через выбранного, без выбора — ЮKassa', () => {
    const keys = { yookassa: { shopId: '1', secretKey: 'k' }, robokassa: { login: 'l', password1: 'a', password2: 'b', password3: 'c', hash: 'md5' as const, test: false } };
    const pick = (config: Partial<ApiConfig>) => {
      const providers = PaymentsModule.register(config as ApiConfig).providers as Array<{ provide?: unknown; useValue?: unknown }>;
      const active = providers.find((p) => p.provide === PAYMENT_PROVIDER)!.useValue as { name: string } | null;
      const all = providers.find((p) => p.provide === PAYMENT_PROVIDERS)!.useValue as Array<{ name: string }>;
      return { active: active?.name ?? null, all: all.map((p) => p.name) };
    };
    expect(pick({ ...keys, paymentProvider: 'robokassa' })).toEqual({ active: 'robokassa', all: ['yookassa', 'robokassa'] });
    expect(pick({ ...keys })).toEqual({ active: 'yookassa', all: ['yookassa', 'robokassa'] });
    expect(pick({ robokassa: keys.robokassa })).toEqual({ active: 'robokassa', all: ['robokassa'] });
    expect(pick({})).toEqual({ active: null, all: [] });
  });
});
