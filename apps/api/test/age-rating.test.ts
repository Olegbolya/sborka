import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { createBlock, createScreen, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let counter = 0;
const sent: { phone: string; code: string }[] = [];

describe('P8.7 · PL-09, SR-01 · возрастная категория', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  const call = (cookie: string, method: 'post' | 'put' | 'patch' | 'get', url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  async function login(): Promise<string> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7903${String(6000000 + ++counter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sent.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    await db.db.update(schema.users).set({ createdAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(schema.users.phoneE164, phone));
    return ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
  }
  async function draft(cookie: string): Promise<{ id: string; slug: string }> {
    const created = (await call(cookie, 'post', '/projects', { title: 'Открытка' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    const { slug } = (await call(cookie, 'get', `/projects/${created.id}`).expect(200)).body as { slug: string };
    return { id: created.id, slug };
  }

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { requireAgeRating: true });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('SR-01 · без возрастной категории сборка не публикуется; с категорией — публикуется, и участник получает знак', async () => {
    const cookie = await login();
    const p = await draft(cookie);
    const blocked = await call(cookie, 'post', `/projects/${p.id}/publish`).expect(422);
    expect(blocked.body.error.issues[0].code).toBe('NO_AGE_RATING');
    expect(blocked.body.error.message).toContain('возрастную категорию');
    await call(cookie, 'patch', `/projects/${p.id}/access-settings`, { ageRating: 7 }).expect(400);
    await call(cookie, 'patch', `/projects/${p.id}/access-settings`, { ageRating: 12 }).expect(200);
    await call(cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const view = (await request(t.http()).get(`/${API_PREFIX}/play/${p.slug}`).expect(200)).body as { state: string; ageRating: number | null };
    expect(view).toMatchObject({ state: 'ok', ageRating: 12 });
  });

  it('PL-09 · категория 18+ сама включает вопрос про возраст, и выключить его нельзя: до подтверждения содержимое не отдаётся', async () => {
    const cookie = await login();
    const p = await draft(cookie);
    const saved = (await call(cookie, 'patch', `/projects/${p.id}/access-settings`, { ageRating: 18, age18: false }).expect(200)).body as { age18: boolean; ageRating: number };
    expect(saved).toMatchObject({ ageRating: 18, age18: true });
    await call(cookie, 'post', `/projects/${p.id}/publish`).expect(200);
    const gate = (await request(t.http()).get(`/${API_PREFIX}/play/${p.slug}`).expect(200)).body as { state: string; document?: unknown };
    expect(gate.state).toBe('age18');
    expect(gate.document).toBeUndefined();
    const open = (await request(t.http()).get(`/${API_PREFIX}/play/${p.slug}`).set('x-play-age', '1').expect(200)).body as { state: string; ageRating: number };
    expect(open).toMatchObject({ state: 'ok', ageRating: 18 });
  });
});
