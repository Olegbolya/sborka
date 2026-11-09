import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { createTestDb, startTestApp, type TestApp, type TestDb, pgSkipGuard } from './helpers.js';

let phoneCounter = 70000;

/**
 * ME-01, ME-02 · сохранённые элементы: сохранить блоки-с-правилами, список, получить фрагмент, удалить.
 */
describe('ME-01/ME-02 · сохранённые элементы', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  const sentCodes: { phone: string; code: string }[] = [];

  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db, otpSender });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') { pg.skip(); return; }
      throw e;
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  beforeEach(() => {
    sentCodes.length = 0;
    vi.clearAllMocks();
  });

  function skip() { return !t; }

  async function loginViaOtp(): Promise<string> {
    const p = `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').set('X-Forwarded-For', `10.9.${phoneCounter % 250}.${phoneCounter % 200 + 1}`).send({ phone: p, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes[sentCodes.length - 1]!;
    sentCodes.length = 0;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').set('X-Forwarded-For', `10.9.${phoneCounter % 250}.${phoneCounter % 200 + 1}`).send({ phone: p, code }).expect(200);
    const cookies = (res.headers['set-cookie'] ?? []) as string[];
    return cookies.find((c) => c.startsWith('session='))!.split(';')[0]!;
  }

  const fragment = { kind: 'blokum-blocks', version: 2, blocks: [{ id: 'b1', type: 'text', name: 'Заголовок' }], variables: [{ id: 'v1', name: 'score', kind: 'number', defaultValue: '0' }] };

  it('ME-01 · аноним → 401', async () => {
    if (skip()) return;
    await request(t.http()).get(`/${API_PREFIX}/elements`).expect(401);
    await request(t.http()).post(`/${API_PREFIX}/elements`).set('X-Blokum-CSRF', '1').send({ name: 'X', fragment }).expect(401);
  });

  it('ME-01 · POST /elements — сохранить элемент', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const res = await request(t.http()).post(`/${API_PREFIX}/elements`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ name: 'Мой блок', fragment }).expect(200);
    expect(typeof (res.body as { id: string }).id).toBe('string');
  });

  it('ME-01 · GET /elements — список содержит сохранённый элемент', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    await request(t.http()).post(`/${API_PREFIX}/elements`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ name: 'Блок A', fragment }).expect(200);
    const res = await request(t.http()).get(`/${API_PREFIX}/elements`).set('Cookie', cookie).expect(200);
    const body = res.body as { elements: Array<{ id: string; name: string }> };
    expect(body.elements.some((e) => e.name === 'Блок A')).toBe(true);
  });

  it('ME-02 · GET /elements/:id — получить фрагмент для вставки', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const saved = await request(t.http()).post(`/${API_PREFIX}/elements`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ name: 'Элемент с правилом', fragment }).expect(200);
    const id = (saved.body as { id: string }).id;
    const res = await request(t.http()).get(`/${API_PREFIX}/elements/${id}`).set('Cookie', cookie).expect(200);
    const body = res.body as { id: string; fragment: { kind: string; variables: Array<{ id: string }> } };
    expect(body.id).toBe(id);
    expect(body.fragment.kind).toBe('blokum-blocks');
    expect(body.fragment.variables[0]?.id).toBe('v1');
  });

  it('ME-01 · DELETE /elements/:id — удалить элемент', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const saved = await request(t.http()).post(`/${API_PREFIX}/elements`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ name: 'Временный', fragment }).expect(200);
    const id = (saved.body as { id: string }).id;
    await request(t.http()).delete(`/${API_PREFIX}/elements/${id}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(204);
    await request(t.http()).get(`/${API_PREFIX}/elements/${id}`).set('Cookie', cookie).expect(404);
  });

  it('ME-02 · чужой элемент → 404', async () => {
    if (skip()) return;
    const cookie1 = await loginViaOtp();
    const cookie2 = await loginViaOtp();
    const saved = await request(t.http()).post(`/${API_PREFIX}/elements`).set('Cookie', cookie1).set('X-Blokum-CSRF', '1').send({ name: 'Чужой', fragment }).expect(200);
    const id = (saved.body as { id: string }).id;
    await request(t.http()).get(`/${API_PREFIX}/elements/${id}`).set('Cookie', cookie2).expect(404);
  });
});
