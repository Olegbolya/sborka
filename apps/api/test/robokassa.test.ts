import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { RobokassaProvider } from '../src/payments/robokassa.provider.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

const OPTS = { login: 'blokker-test', password1: 'pass-one', password2: 'pass-two', password3: 'pass-three' };
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Поддельный сервер Robokassa: состояние операций в памяти, ответы того же вида, что у OpStateExt и API возвратов. */
function fakeRobokassa() {
  const ops = new Map<string, { code: number; outSum: string; order: string }>();
  const refunds: Array<{ opKey: string; sum: number; auth: string }> = [];
  const impl = vi.fn((url: string | URL, init?: RequestInit) => {
    const u = new URL(typeof url === 'string' ? url : url.href);
    const xml = (body: string) => Promise.resolve(new Response(`<?xml version="1.0" encoding="utf-8"?><OperationStateResponse>${body}</OperationStateResponse>`, { status: 200 }));
    if (u.pathname.endsWith('/OpStateExt')) {
      const inv = u.searchParams.get('InvoiceID')!;
      if (u.searchParams.get('Signature') !== md5(`${OPTS.login}:${inv}:${OPTS.password2}`)) return xml('<Result><Code>2</Code></Result>');
      const op = ops.get(inv);
      if (!op) return xml('<Result><Code>3</Code></Result>');
      return xml(
        `<Result><Code>0</Code></Result><State><Code>${op.code}</Code></State><Info><OpKey>key-${inv}</OpKey><OutSum>${op.outSum}</OutSum></Info><UserField><Field><Name>shp_order</Name><Value>${op.order}</Value></Field></UserField>`,
      );
    }
    if (u.pathname.endsWith('/Refund/Create')) {
      const [h, b, s] = (init?.body as string).split('.');
      const ok = s === createHmac('sha256', OPTS.password3).update(`${h}.${b}`).digest('base64url');
      const p = JSON.parse(Buffer.from(b!, 'base64url').toString()) as { OpKey: string; RefundSum: number };
      refunds.push({ opKey: p.OpKey, sum: p.RefundSum, auth: ok ? 'ok' : 'bad' });
      return Promise.resolve(new Response(JSON.stringify(ok ? { success: true, requestId: 'rq-1' } : { success: false, message: 'bad jwt' }), { status: 200 }));
    }
    return Promise.resolve(new Response('', { status: 500 }));
  });
  return { impl: impl as unknown as typeof fetch, ops, refunds };
}

describe('P7.3 · Robokassa: запасной провайдер платежей', () => {
  let db: TestDb;
  let t: TestApp;
  let rk: ReturnType<typeof fakeRobokassa>;
  let provider: RobokassaProvider;
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
    const p = `+7902${String(3000000 + ++phone)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: p, captchaToken: 'ok' }).expect(200);
    const { code } = otp.codes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone: p, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, p));
    return { cookie, userId: u!.id };
  }
  const buy = async (planCode = 'AUTHOR') => {
    const { cookie, userId } = await login();
    const res = await request(t.http()).post(`/${API_PREFIX}/orders`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ kind: 'SUBSCRIPTION', planCode, period: 'MONTH' }).expect(201);
    const [o] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId as string));
    return { o: o!, userId, url: new URL(String(res.body.confirmationUrl)) };
  };
  const resultParams = (o: { id: string; providerPaymentId: string | null; amountKop: number }, over: Record<string, string> = {}) => {
    const outSum = (o.amountKop / 100).toFixed(2);
    return { OutSum: outSum, InvId: o.providerPaymentId!, Shp_order: o.id, SignatureValue: md5(`${outSum}:${o.providerPaymentId!}:${OPTS.password2}:Shp_order=${o.id}`).toUpperCase(), ...over };
  };
  const result = (params: Record<string, string>) => request(t.http()).post(`/${API_PREFIX}/payments/robokassa/result`).type('form').send(params);

  beforeAll(async () => {
    db = await createTestDb();
    rk = fakeRobokassa();
    provider = new RobokassaProvider(OPTS, rk.impl);
    t = await startTestApp({ db: db.db, otpSender: otp, captchaVerifier: captcha, paymentProvider: provider }, { phoneLogin: true });
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('P7.3 · Robokassa: ссылка на оплату подписана паролем №1, номер счёта — целое число из номера заказа', async () => {
    const { o, url } = await buy();
    expect(o.provider).toBe('robokassa');
    expect(o.providerPaymentId).toBe(RobokassaProvider.invId(o.id));
    expect(o.providerPaymentId).toMatch(/^\d{1,16}$/);
    expect(url.origin + url.pathname).toBe('https://auth.robokassa.ru/Merchant/Index.aspx');
    expect(url.searchParams.get('MerchantLogin')).toBe(OPTS.login);
    const sum = (o.amountKop / 100).toFixed(2);
    expect(url.searchParams.get('OutSum')).toBe(sum);
    expect(url.searchParams.get('InvId')).toBe(o.providerPaymentId);
    expect(url.searchParams.get('SignatureValue')).toBe(md5(`${OPTS.login}:${sum}:${o.providerPaymentId!}:${OPTS.password1}:Shp_order=${o.id}`));
    expect(url.searchParams.has('IsTest')).toBe(false);
  });

  it('P7.3 · Robokassa: подделанная подпись отклонена, оплата не засчитана', async () => {
    const { o } = await buy();
    rk.ops.set(o.providerPaymentId!, { code: 100, outSum: (o.amountKop / 100).toFixed(2), order: o.id });
    await result(resultParams(o, { SignatureValue: 'A'.repeat(32) })).expect(400);
    await result(resultParams(o, { OutSum: '1.00' })).expect(400);
    const { SignatureValue: _s, ...noSig } = resultParams(o);
    await result(noSig).expect(400);
    const [after] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after!.status).toBe('PENDING');
  });

  it('P7.3 · Robokassa: верное уведомление отвечает OK{InvId}; повтор 5 раз = одна оплата и одна подписка', async () => {
    const { o, userId } = await buy();
    rk.ops.set(o.providerPaymentId!, { code: 100, outSum: (o.amountKop / 100).toFixed(2), order: o.id });
    for (let i = 0; i < 5; i++) {
      const res = await result(resultParams(o)).expect(200);
      expect(res.text).toBe(`OK${o.providerPaymentId!}`);
      expect(res.headers['content-type']).toContain('text/plain');
    }
    const subs = await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ planCode: 'AUTHOR', status: 'ACTIVE' });
    const [paid] = await db.db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(paid!.status).toBe('PAID');
  });

  it('P7.3 · Robokassa: уведомление с верной подписью, но платёж у провайдера не оплачен или сумма не та — не засчитывается', async () => {
    const a = await buy();
    rk.ops.set(a.o.providerPaymentId!, { code: 5, outSum: (a.o.amountKop / 100).toFixed(2), order: a.o.id });
    await result(resultParams(a.o)).expect(200);
    expect((await db.db.select().from(schema.orders).where(eq(schema.orders.id, a.o.id)))[0]!.status).toBe('PENDING');
    const b = await buy();
    rk.ops.set(b.o.providerPaymentId!, { code: 100, outSum: '1.00', order: b.o.id });
    await result(resultParams(b.o)).expect(400);
    expect((await db.db.select().from(schema.orders).where(eq(schema.orders.id, b.o.id)))[0]!.status).toBe('PENDING');
    const c = await buy();
    rk.ops.set(c.o.providerPaymentId!, { code: 100, outSum: (c.o.amountKop / 100).toFixed(2), order: b.o.id });
    await result(resultParams(c.o)).expect(400);
    expect((await db.db.select().from(schema.orders).where(eq(schema.orders.id, c.o.id)))[0]!.status).toBe('PENDING');
  });

  it('P7.3 · Robokassa: уведомление ЮKassa на этом провайдере не принимается', async () => {
    await request(t.http()).post(`/${API_PREFIX}/payments/yookassa/notify`).send({ event: 'payment.succeeded', object: { id: 'x'.repeat(20) } }).expect(404);
  });

  it('P7.3 · Robokassa: getPayment — состояния, чужой счёт и неверный пароль', async () => {
    rk.ops.set('777', { code: 100, outSum: '10.50', order: 'ord-1' });
    expect(await provider.getPayment('777')).toEqual({ id: '777', status: 'succeeded', amountKop: 1050, orderId: 'ord-1' });
    rk.ops.set('778', { code: 60, outSum: '10.50', order: 'ord-1' });
    expect((await provider.getPayment('778'))!.status).toBe('canceled');
    rk.ops.set('779', { code: 50, outSum: '10.50', order: 'ord-1' });
    expect((await provider.getPayment('779'))!.status).toBe('pending');
    expect(await provider.getPayment('123456')).toBeNull();
    expect(await provider.getPayment('не-число')).toBeNull();
    await expect(new RobokassaProvider({ ...OPTS, password2: 'wrong' }, rk.impl).getPayment('777')).rejects.toThrow();
  });

  it('P7.3 · Robokassa: возврат — ключ операции из OpStateExt и JWT с паролем №3', async () => {
    rk.ops.set('888', { code: 100, outSum: '1490.00', order: 'ord-2' });
    const r = await provider.refund({ providerPaymentId: '888', amountKop: 149000, idempotenceKey: 'k' });
    expect(r).toEqual({ refundId: 'rq-1', status: 'processing' });
    expect(rk.refunds.at(-1)).toEqual({ opKey: 'key-888', sum: 1490, auth: 'ok' });
    await expect(new RobokassaProvider({ ...OPTS, password3: 'wrong' }, rk.impl).refund({ providerPaymentId: '888', amountKop: 100, idempotenceKey: 'k' })).rejects.toThrow('bad jwt');
    await expect(provider.refund({ providerPaymentId: '999', amountKop: 100, idempotenceKey: 'k' })).rejects.toThrow();
  });

  it('P7.3 · Robokassa: другой алгоритм подписи (SHA-256) и тестовый режим', async () => {
    const p = new RobokassaProvider({ ...OPTS, hash: 'sha256', test: true }, rk.impl);
    const created = await p.createPayment({ orderId: 'abc', amountKop: 10050, description: 'Тест', returnUrl: 'https://blokker.ru/x' });
    const u = new URL(created.confirmationUrl);
    expect(u.searchParams.get('IsTest')).toBe('1');
    expect(u.searchParams.get('SignatureValue')).toBe(createHash('sha256').update(`${OPTS.login}:100.50:${created.providerPaymentId}:${OPTS.password1}:Shp_order=abc`).digest('hex'));
  });
});
