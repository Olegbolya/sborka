import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PLANS, schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

/*
 * P7.1 · строки таблицы тарифов (04-TARIFFS §2), которые сервер проверяет на своих маршрутах: точки доступа на сборку, оформленный
 * QR, выгрузка CSV и XLSX, свои шрифты. Для каждого тарифа ожидание считается из его лимитов.
 */
const CODES = ['FREE', 'PASS', 'AUTHOR', 'PLUS', 'PRO'] as const;
const sent: { phone: string; code: string }[] = [];

describe('P7.1 · таблица тарифов на маршрутах API: каждая строка × каждый тариф', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let phones = 0;

  const send = (method: 'post' | 'put' | 'get', url: string, cookie: string, body?: object) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie);
    return method === 'get' ? r : r.set('X-Blokum-CSRF', '1').send(body ?? {});
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  /** A person on the plan and his project; «Праздник» is a pass on that project. */
  async function person(code: (typeof CODES)[number]): Promise<{ cookie: string; projectId: string }> {
    const phone = `+7905${String(5000000 + ++phones)}`;
    await db.db.delete(schema.otpRequests);
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code: sent.pop()!.code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((x) => x.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    const projectId = ((await send('post', '/projects', cookie, { title: 'Тарифы' }).expect(200)).body as { id: string }).id;
    const day = 86_400_000;
    if (code === 'PASS') await db.db.insert(schema.entitlements).values({ userId: u!.id, projectId, feature: 'PASS', validFrom: new Date(Date.now() - day), validTo: new Date(Date.now() + 29 * day) });
    else if (code !== 'FREE') await db.db.insert(schema.subscriptions).values({ userId: u!.id, planCode: code, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - day), currentPeriodEnd: new Date(Date.now() + 29 * day) });
    return { cookie, projectId };
  }

  for (const code of CODES) {
    const l = PLANS.find((p) => p.code === code)!.limits;

    it(`P7.1 · ${code} · точек доступа на сборку: ${l.accessPointsPerProject ?? 'без ограничений'}`, async () => {
      const { cookie, projectId } = await person(code);
      const have = ((await send('get', `/projects/${projectId}/access-points`, cookie).expect(200)).body as unknown[]).length;
      const room = Math.min((l.accessPointsPerProject ?? 6) - have, 6);
      for (let i = 0; i < room; i++) await send('post', `/projects/${projectId}/access-points`, cookie, { label: `Точка ${i}` }).expect(200);
      // The ceiling is reached only where it is small enough to reach in a test (up to 6 points).
      if (l.accessPointsPerProject !== null && l.accessPointsPerProject <= 6) {
        const over = await send('post', `/projects/${projectId}/access-points`, cookie, { label: 'Лишняя' }).expect(402);
        expect((over.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT');
      }
    });

    it(`P7.1 · ${code} · оформленный QR: ${l.styledQr ? 'доступен' : 'закрыт'}`, async () => {
      const { cookie, projectId } = await person(code);
      let points = (await send('get', `/projects/${projectId}/access-points`, cookie).expect(200)).body as Array<{ id: string }>;
      if (points.length === 0) points = [(await send('post', `/projects/${projectId}/access-points`, cookie, { kind: 'QR' }).expect(200)).body as { id: string }];
      const res = await send('put', `/projects/${projectId}/access-points/${points[0]!.id}/qr-style`, cookie, { fg: '#112233', bg: '#ffffff', shape: 'square', frame: 'none', caption: '' });
      if (l.styledQr) expect(res.status, JSON.stringify(res.body)).toBe(200);
      else expect(res.status).toBe(402);
    });

    it(`P7.1 · ${code} · выгрузка ответов: ${l.exportFormats.join(' + ') || 'нет'}`, async () => {
      const { cookie, projectId } = await person(code);
      for (const format of ['csv', 'xlsx'] as const) {
        const res = await send('get', `/projects/${projectId}/responses/export.${format}`, cookie);
        expect(res.status, `${code} ${format}`).toBe(l.exportFormats.includes(format) ? 200 : 402);
      }
    });

    it(`P7.1 · ${code} · свои шрифты: ${l.ownFonts ? 'доступны' : 'закрыты'}`, async () => {
      const { cookie } = await person(code);
      // A broken file: where fonts are allowed it is refused as a bad file (400), where they are not — by the plan (402) before that.
      const res = await request(t.http()).post(`/${API_PREFIX}/fonts`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').field('license', 'OFL').attach('file', Buffer.from('не шрифт'), { filename: 'a.ttf', contentType: 'application/octet-stream' });
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(l.ownFonts || code === 'PASS' ? 400 : 402);
    });
  }
});
