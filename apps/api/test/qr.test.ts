import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { createDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import { DEFAULT_QR_STYLE, QR_MIN_CONTRAST, colourProblem, contrastRatio, parseQrStyle, reads, renderPng } from '../src/projects/qr-render.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const URL_OF = 'https://blokker.ru/q/abc12345';
const sent: { phone: string; code: string }[] = [];

describe('Q-03…Q-06 · конструктор QR, печать, проверка чтения, статистика точки', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let cookie: string;
  let other: string;
  let projectId: string;
  const send = (method: 'post' | 'put' | 'get', url: string, c: string, body?: object) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', c);
    return method === 'get' ? r : r.set('X-Blokum-CSRF', '1').send(body ?? {});
  };
  async function login(phone: string): Promise<string> {
    await db.db.delete(schema.otpRequests);
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code: sent.pop()!.code }).expect(200);
    return ((res.headers['set-cookie'] ?? []) as string[]).find((x) => x.startsWith('session='))!.split(';')[0]!;
  }
  const point = async (kind: 'QR' | 'LINK' = 'QR'): Promise<{ id: string; code: string }> => (await send('post', `/projects/${projectId}/access-points`, cookie, { label: 'Афиша', kind }).expect(200)).body as { id: string; code: string };
  const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
      cookie = await login('+79051230101');
      other = await login('+79051230102');
      projectId = ((await send('post', '/projects', cookie, { title: 'Афиша' }).expect(200)).body as { id: string }).id;
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('Q-03 · контраст: тёмные точки на светлом фоне читаются, светлые на светлом и «негатив» — нет, причина названа', () => {
    expect(colourProblem(DEFAULT_QR_STYLE)).toBeNull();
    expect(colourProblem({ fg: '#1b3a6b', bg: '#fff4d6' })).toBeNull();
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(colourProblem({ fg: '#bbbbbb', bg: '#ffffff' })).toMatch(/мало контраста/);
    expect(colourProblem({ fg: '#ffffff', bg: '#000000' })).toMatch(/темнее фона/);
    expect(QR_MIN_CONTRAST).toBeGreaterThanOrEqual(4);
  });

  it('Q-03 · оформление разбирается строго: неверный цвет, форма, длинная подпись и угловые скобки отклоняются', () => {
    expect(() => parseQrStyle({ fg: 'красный' })).toThrow(/#RRGGBB/);
    expect(() => parseQrStyle({ dots: 'star' })).toThrow(/Форма точек/);
    expect(() => parseQrStyle({ eyes: 'hex' })).toThrow(/глазков/);
    expect(() => parseQrStyle({ caption: 'я'.repeat(41) })).toThrow(/длиннее/);
    expect(() => parseQrStyle({ caption: '<script>' })).toThrow(/нельзя/);
    expect(parseQrStyle({ caption: '  Сканируй  ', frame: true })).toMatchObject({ caption: 'Сканируй', frame: true, fg: '#000000' });
  });

  it('Q-05 · каждое оформление читается как адрес точки: круглые точки, скруглённые и круглые «глазки», рамка с подписью на русском, цвета', async () => {
    const looks = [
      { ...DEFAULT_QR_STYLE },
      { ...DEFAULT_QR_STYLE, dots: 'rounded' as const, eyes: 'rounded' as const },
      { ...DEFAULT_QR_STYLE, dots: 'circle' as const, eyes: 'circle' as const, fg: '#1b3a6b', bg: '#fff4d6' },
      { ...DEFAULT_QR_STYLE, frame: true, caption: 'Пройди сборку — 2 минуты' },
    ];
    for (const look of looks) expect(await reads(await renderPng(URL_OF, look, null, 1024), URL_OF), JSON.stringify(look)).toBe(true);
  });

  it('Q-05 · чужой код не принимается за свой: проверка сравнивает именно адрес точки', async () => {
    const png = await renderPng('https://blokker.ru/q/drugoj999', DEFAULT_QR_STYLE, null, 1024);
    expect(await reads(png, URL_OF)).toBe(false);
  });

  it('Q-03 · логотип в центре: код с логотипом читается (коррекция ошибок H)', async () => {
    const logo = { dataUri: `data:image/png;base64,${(await (await import('sharp')).default({ create: { width: 64, height: 64, channels: 4, background: '#d9381e' } }).png().toBuffer()).toString('base64')}` };
    expect(await reads(await renderPng(URL_OF, { ...DEFAULT_QR_STYLE, frame: true, caption: 'Блоккер' }, logo, 1024), URL_OF)).toBe(true);
  });

  it('Q-03 · оформление хранится у точки: сохранить, прочитать, нечитаемые цвета не сохраняются', async () => {
    const ap = await point();
    const base = `/projects/${projectId}/access-points/${ap.id}`;
    expect((await send('get', `${base}/qr-style`, cookie).expect(200)).body).toMatchObject({ fg: '#000000', dots: 'square', frame: false });
    const saved = await send('put', `${base}/qr-style`, cookie, { fg: '#1b3a6b', bg: '#fff4d6', dots: 'rounded', eyes: 'circle', frame: true, caption: 'Сканируй' }).expect(200);
    expect(saved.body).toMatchObject({ fg: '#1b3a6b', dots: 'rounded', eyes: 'circle', caption: 'Сканируй' });
    expect((await send('get', `${base}/qr-style`, cookie).expect(200)).body).toMatchObject({ fg: '#1b3a6b', caption: 'Сканируй' });
    const bad = await send('put', `${base}/qr-style`, cookie, { fg: '#cccccc', bg: '#ffffff' }).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'QR_UNREADABLE' });
    expect(bad.body.error.message).toMatch(/контраста/);
    expect((await send('get', `${base}/qr-style`, cookie).expect(200)).body.fg).toBe('#1b3a6b');
    await send('put', `${base}/qr-style`, cookie, { logoMediaId: 'netutakogo1' }).expect(400);
  });

  it('Q-04 · PNG и SVG берут сохранённое оформление, PDF для печати отдаётся в трёх раскладках', async () => {
    const ap = await point();
    const base = `/projects/${projectId}/access-points/${ap.id}`;
    await send('put', `${base}/qr-style`, cookie, { dots: 'circle', frame: true, caption: 'Привет' }).expect(200);
    const png = (await send('get', `${base}/qr.png?size=1024`, cookie).buffer(true).parse(binary).expect(200)).body as Buffer;
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const listed = (await send('get', `/projects/${projectId}/access-points`, cookie)).body as Array<{ id: string; url: string }>;
    expect(await reads(png, listed.find((p) => p.id === ap.id)!.url)).toBe(true);
    const svg = ((await send('get', `${base}/qr.svg`, cookie).buffer(true).parse(binary).expect(200)).body as Buffer).toString('utf8');
    expect(svg).toContain('<circle');
    expect(svg).toContain('Привет');
    for (const layout of ['a4', 'a6', 'cards']) {
      const res = await send('get', `${base}/qr.pdf?layout=${layout}`, cookie).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  }, 30_000);

  it('Q-03 · чужой пользователь не видит и не меняет оформление и не скачивает печать', async () => {
    const ap = await point();
    const base = `/projects/${projectId}/access-points/${ap.id}`;
    await send('get', `${base}/qr-style`, other).expect(403);
    await send('put', `${base}/qr-style`, other, { fg: '#000000' }).expect(403);
    await send('get', `${base}/qr.pdf`, other).expect(403);
  });

  it('Q-06 · статистика точки по дням: открытия по QR, начатые и завершённые', async () => {
    const ap = await point();
    const [v] = await db.db.insert(schema.projectVersions).values({ projectId, number: 99, document: createDocument({ title: 'Афиша' }) as never, schemaVersion: 1, sha256: 'qr-v99', kind: 'PUBLISHED' }).returning();
    const day = new Date().toISOString().slice(0, 10);
    const started = new Date();
    const session = (done: boolean) => ({ projectId, versionId: v!.id, accessPointId: ap.id, startedAt: started, lastActivityAt: started, status: done ? ('COMPLETED' as const) : ('IN_PROGRESS' as const), completedAt: done ? started : null, durationMs: done ? 60_000 : null, deviceType: 'PHONE' as const, isPreview: false });
    await db.db.insert(schema.participantSessions).values([session(true), session(true), session(false)]);
    await db.db.insert(schema.projectStatsDaily).values({ projectId, day, accessPointId: ap.id, opens: 5 }).onConflictDoNothing();
    const stats = (await send('get', `/projects/${projectId}/analytics?from=${day}&to=${day}`, cookie).expect(200)).body as { byAccessPoint: Array<{ id: string; opens: number; byDay: Array<{ day: string; opens: number; starts: number; completions: number }> }> };
    const mine = stats.byAccessPoint.find((p) => p.id === ap.id)!;
    expect(mine.opens).toBe(5);
    expect(mine.byDay).toEqual([{ day, opens: 5, starts: 3, completions: 2 }]);
  });
});
