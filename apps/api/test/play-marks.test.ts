import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;

/** Создать приложение с перехватом OTP-кодов и вернуть helper для входа. */
async function makeAppWithAuth(): Promise<{ t: TestApp; db: TestDb; loginViaOtp: (phone?: string) => Promise<string> }> {
  const db = await createTestDb();
  const sentCodes: { phone: string; code: string }[] = [];
  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
  const t = await startTestApp({ db: db.db, otpSender, captchaVerifier });

  async function loginViaOtp(phone?: string): Promise<string> {
    // Clear rate-limit state between logins
    await db.db.delete(schema.otpRequests);
    const p = phone ?? `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, code })
      .expect(200);
    const cookies = (res.headers['set-cookie'] ?? []) as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('session='));
    if (!sessionCookie) throw new Error('Нет session cookie');
    return sessionCookie.split(';')[0]!;
  }

  return { t, db, loginViaOtp };
}

import { createBlock, createScreen, type ProjectDocument } from '@blokum/schema';
const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const open = (t: TestApp, method: 'get' | 'post', url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set({ 'X-Blokum-CSRF': '1', ...headers });
  return body === undefined ? r : r.send(body as object);
};

describe('PL-16, PL-18, TS-11 · пометки плеера и жалобы', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });
  beforeEach(async () => {
    cookie = await loginViaOtp();
  });

  async function published(): Promise<{ id: string; slug: string }> {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Пометки' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, slug: created.slug };
  }
  const report = (body: Record<string, unknown>) => open(t, 'post', '/reports', body);

  it('PL-16 · на тарифе «Старт» плеер просит водяной знак', async () => {
    const p = await published();
    const view = (await open(t, 'get', `/play/${p.slug}`).expect(200)).body as { watermark: boolean; ad: unknown };
    expect(view.watermark).toBe(true);
    expect(view.ad).toBeNull();
  });

  it('PL-18 · «Это реклама»: рекламодатель и erid приходят в плеер; ошибки заполнения по-русски; пустое тело выключает пометку', async () => {
    const p = await published();
    const bad = await call(t, cookie, 'patch', `/projects/${p.id}/advertising`, { advertiser: 'ООО «Ромашка»', erid: '!!' }).expect(422);
    expect(bad.body.error.message).toContain('erid');
    await call(t, cookie, 'patch', `/projects/${p.id}/advertising`, { advertiser: 'А', erid: '2VtzqwP9abc' }).expect(422);
    await call(t, cookie, 'patch', `/projects/${p.id}/advertising`, { advertiser: 'ООО «Ромашка»', erid: '2VtzqwP9abc', inn: '123' }).expect(422);
    const ok = await call(t, cookie, 'patch', `/projects/${p.id}/advertising`, { advertiser: 'ООО «Ромашка»', inn: '7707083893', erid: '2VtzqwP9abc' }).expect(200);
    expect(ok.body.ad).toEqual({ advertiser: 'ООО «Ромашка»', inn: '7707083893', erid: '2VtzqwP9abc' });
    const view = (await open(t, 'get', `/play/${p.slug}`).expect(200)).body as { ad: unknown };
    expect(view.ad).toEqual({ advertiser: 'ООО «Ромашка»', inn: '7707083893', erid: '2VtzqwP9abc' });
    expect((await call(t, cookie, 'get', `/projects/${p.id}/advertising`).expect(200)).body.ad).not.toBeNull();
    await call(t, cookie, 'patch', `/projects/${p.id}/advertising`, {}).expect(200);
    expect(((await open(t, 'get', `/play/${p.slug}`).expect(200)).body as { ad: unknown }).ad).toBeNull();
  });

  it('TS-11, PL-16 · жалоба хранит снимок опубликованной версии, приоритет и срок по категории', async () => {
    const p = await published();
    const before = Date.now();
    await report({ slug: p.slug, category: 'A2', text: 'Просят пароль от почты' }).expect(201);
    await report({ slug: p.slug, category: 'B7', text: 'Похоже на чужой магазин', contact: 'mail@example.ru', consent: true }).expect(201);
    const rows = await db.db.select().from(schema.reports).where(eq(schema.reports.projectId, p.id));
    const [row] = await db.db.select({ v: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, p.id));
    expect(rows).toHaveLength(2);
    const a2 = rows.find((r) => r.category === 'A2')!;
    expect(a2).toMatchObject({ priority: 'P0', status: 'NEW', snapshotVersionId: row!.v, reporterContact: null });
    expect(a2.slaDueAt.getTime() - before).toBeLessThan(2 * 3_600_000);
    const b7 = rows.find((r) => r.category === 'B7')!;
    expect(b7).toMatchObject({ priority: 'P2', reporterContact: 'mail@example.ru' });
    expect(b7.slaDueAt.getTime() - before).toBeGreaterThan(70 * 3_600_000);
    // Адрес жалобщика не хранится, только хэш.
    expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
  });

  it('TS-11 · жалоба: проверки полей и ограничение частоты', async () => {
    const p = await published();
    await db.db.delete(schema.reports);
    expect((await report({ slug: p.slug, category: 'ZZ', text: 'Что-то не так' }).expect(422)).body.error.message).toBe('Выберите, что не так.');
    expect((await report({ slug: p.slug, category: 'A3', text: 'ой' }).expect(422)).body.error.code).toBe('REPORT_TEXT');
    expect((await report({ slug: p.slug, category: 'A3', text: 'Обман с призом', contact: 'a@b.ru' }).expect(422)).body.error.code).toBe('REPORT_CONSENT');
    await report({ slug: 'net-takoj-sborki', category: 'A3', text: 'Обман с призом' }).expect(404);
    for (let i = 0; i < 5; i++) await report({ slug: p.slug, category: 'C', text: `Жалоба номер ${i}` }).expect(201);
    expect((await report({ slug: p.slug, category: 'C', text: 'Ещё одна жалоба' }).expect(429)).body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});
