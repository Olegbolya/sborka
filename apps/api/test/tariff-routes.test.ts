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

  const send = (method: 'post' | 'put' | 'get' | 'patch', url: string, cookie: string, body?: object) => {
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

    it(`PL-01 · P7.1 · ${code} · свой адрес ссылки: ${l.customSlug ? 'доступен' : 'закрыт'}`, async () => {
      const { cookie, projectId } = await person(code);
      const info = (await send('get', `/projects/${projectId}/slug`, cookie).expect(200)).body as { slug: string; allowed: boolean };
      expect(info.allowed).toBe(l.customSlug || code === 'PASS');
      const want = `moy-${code.toLowerCase()}-${projectId.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
      const res = await send('patch', `/projects/${projectId}/slug`, cookie, { slug: want });
      if (info.allowed) {
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect((await send('get', `/projects/${projectId}/slug`, cookie).expect(200)).body).toMatchObject({ slug: want });
      } else {
        expect(res.status).toBe(402);
        expect((res.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT');
        expect((await send('get', `/projects/${projectId}/slug`, cookie).expect(200)).body).toMatchObject({ slug: info.slug });
      }
    });

    it(`P7.1 · ${code} · «Мои шаблоны» и «Мои элементы»: ${l.ownTemplates ?? 'без ограничений'} / ${l.ownElements ?? 'без ограничений'}`, async () => {
      const { cookie, projectId } = await person(code);
      // «Праздник» не меняет эти лимиты: они считаются по аккаунту, а у аккаунта без подписки это «Старт».
      const account = code === 'PASS' ? PLANS.find((p) => p.code === 'FREE')!.limits : l;
      for (const [what, max, url, body] of [
        ['шаблоны', account.ownTemplates, '/templates', { projectId }],
        ['элементы', account.ownElements, '/elements', { name: 'Элемент', fragment: { blocks: [] } }],
      ] as const) {
        const room = Math.min(max ?? 12, 12);
        for (let i = 0; i < room; i++) await send('post', url, cookie, body).expect(200);
        const over = await send('post', url, cookie, body);
        if (max !== null && max <= 12) {
          expect(over.status, `${code} ${what}`).toBe(402);
          expect((over.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT');
        } else {
          expect(over.status, `${code} ${what}`).toBe(200);
        }
      }
    });

    it(`P7.1 · ${code} · редактор узнаёт границы сборки: ${l.screensPerProject} экранов, ${l.rulesPerProject} правил`, async () => {
      const { cookie, projectId } = await person(code);
      const res = (await send('get', `/projects/${projectId}/limits`, cookie).expect(200)).body as { plan: { code: string }; screens: number; rules: number };
      // «Праздник» поднимает границы сборки до своих; без него — тариф человека.
      expect(res).toMatchObject({ plan: { code }, screens: l.screensPerProject, rules: l.rulesPerProject });
    });

    it(`P7.1 · ${code} · свои шрифты: ${l.ownFonts ? 'доступны' : 'закрыты'}`, async () => {
      const { cookie } = await person(code);
      // A broken file: where fonts are allowed it is refused as a bad file (400), where they are not — by the plan (402) before that.
      const res = await request(t.http()).post(`/${API_PREFIX}/fonts`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').field('license', 'OFL').attach('file', Buffer.from('не шрифт'), { filename: 'a.ttf', contentType: 'application/octet-stream' });
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(l.ownFonts || code === 'PASS' ? 400 : 402);
    });
  }
  it('PL-01 · свой адрес: проверка вида, занятости, стоп-слов; чужой адрес не отнять; QR при смене адреса не ломается', async () => {
    const a = await person('PRO');
    const b = await person('PRO');
    const bad = async (slug: unknown, status: number, code: string) => {
      const res = await send('patch', `/projects/${a.projectId}/slug`, a.cookie, { slug });
      expect(res.status, `${String(slug)}: ${JSON.stringify(res.body)}`).toBe(status);
      expect((res.body as { error: { code: string } }).error.code).toBe(code);
    };
    await bad('ab', 400, 'INVALID_INPUT');
    await bad('a'.repeat(41), 400, 'INVALID_INPUT');
    await bad('Большой', 400, 'INVALID_INPUT');
    await bad('-start', 400, 'INVALID_INPUT');
    await bad('two--dash', 400, 'INVALID_INPUT');
    await bad(42, 400, 'INVALID_INPUT');
    await bad('admin', 409, 'SLUG_TAKEN');
    const points = (await send('get', `/projects/${a.projectId}/access-points`, a.cookie).expect(200)).body as Array<{ code: string }>;
    await send('patch', `/projects/${a.projectId}/slug`, a.cookie, { slug: 'konkurs-2026' }).expect(200);
    await send('patch', `/projects/${b.projectId}/slug`, b.cookie, { slug: 'konkurs-2026' }).expect(409);
    await send('patch', `/projects/${a.projectId}/slug`, a.cookie, { slug: 'konkurs-2026' }).expect(200);
    // Not the owner: access is refused.
    await send('patch', `/projects/${a.projectId}/slug`, b.cookie, { slug: 'chuzhoy-adres' }).expect(403);
    const after = (await send('get', `/projects/${a.projectId}/access-points`, a.cookie).expect(200)).body as Array<{ code: string }>;
    expect(after.map((p) => p.code)).toEqual(points.map((p) => p.code));
  });
});
