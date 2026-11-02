import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 60000;

describe('TS-27 · E-21 · SVG-импорт контуров', () => {
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
    } catch {
      // PostgreSQL недоступен — тесты пропускаются
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
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes[sentCodes.length - 1]!;
    sentCodes.length = 0;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, code })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.find((c) => c.startsWith('session='))!.split(';')[0]!;
  }

  // ── TS-27 · безопасность ─────────────────────────────────────────────────

  it('TS-27 · анонимный → 401', async () => {
    if (skip()) return;
    const svg = Buffer.from('<svg><path d="M0 0 L100 100"/></svg>');
    await request(t.http())
      .post(`/${API_PREFIX}/editor/svg-import`)
      .attach('file', svg, { filename: 'test.svg', contentType: 'image/svg+xml' })
      .expect(401);
  });

  it('TS-27 · SVG со скриптом и foreignObject — только контур в ответе', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    // The SVG contains dangerous elements AND a geometric path.
    const svg = Buffer.from(`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert(document.cookie)</script>
  <foreignObject width="100" height="100"><div>XSS</div></foreignObject>
  <path d="M10,20 L90,20 L50,80 Z"/>
</svg>`);

    const res = await request(t.http())
      .post(`/${API_PREFIX}/editor/svg-import`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', svg, { filename: 'test.svg', contentType: 'image/svg+xml' })
      .expect(200);

    // Only the geometric path is returned, no script/foreignObject content
    expect(Array.isArray(res.body.paths)).toBe(true);
    expect(res.body.paths).toHaveLength(1);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('alert');
    expect(body).not.toContain('cookie');
    expect(body).not.toContain('XSS');
    expect(body).not.toContain('script');
    expect(body).not.toContain('foreignObject');
    // The path itself is a valid normalised contour starting with M
    expect((res.body.paths[0] as { d: string }).d).toMatch(/^M/);
    expect(typeof (res.body.paths[0] as { d: string; closed: boolean }).closed).toBe('boolean');
  });

  it('TS-27 · SVG с несколькими фигурами — все контуры в ответе', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const svg = Buffer.from(`<svg>
  <rect x="0" y="0" width="100" height="50"/>
  <circle cx="50" cy="50" r="40"/>
  <path d="M0,0 L100,0 L100,100 Z"/>
</svg>`);

    const res = await request(t.http())
      .post(`/${API_PREFIX}/editor/svg-import`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', svg, { filename: 'shapes.svg', contentType: 'image/svg+xml' })
      .expect(200);

    expect(res.body.paths).toHaveLength(3);
  });

  it('TS-27 · SVG без геометрических контуров → 422', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const svg = Buffer.from('<svg><text>hello</text></svg>');

    await request(t.http())
      .post(`/${API_PREFIX}/editor/svg-import`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', svg, { filename: 'empty.svg', contentType: 'image/svg+xml' })
      .expect(422);
  });

  it('TS-27 · полигон → нормализованный контур', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const svg = Buffer.from('<svg><polygon points="0,0 100,0 50,100"/></svg>');

    const res = await request(t.http())
      .post(`/${API_PREFIX}/editor/svg-import`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', svg, { filename: 'triangle.svg', contentType: 'image/svg+xml' })
      .expect(200);

    expect(res.body.paths).toHaveLength(1);
    expect((res.body.paths[0] as { closed: boolean }).closed).toBe(true);
  });
});
