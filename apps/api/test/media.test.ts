import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { IMediaQueue } from '../src/media/media-jobs.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/** Minimal JPEG header (JFIF) — enough for file-type to detect image/jpeg. */
const JPEG_1PX = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
  0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xff,
  0xd9,
]);

/** Minimal valid GIF89a. */
const GIF_1PX = Buffer.from(
  '47494638396101000100800000ffffff00000021f90400000000002c00000000010001000002024401003b',
  'hex',
);

/** Valid minimal Lottie JSON. */
const VALID_LOTTIE = Buffer.from(
  JSON.stringify({ v: '5.9.0', ip: 0, op: 60, fr: 25, w: 100, h: 100, layers: [], assets: [] }),
);

/** HTML disguised as a JPEG upload. */
const HTML_CONTENT = Buffer.from('<!DOCTYPE html><html><body>xss</body></html>');

/** PDF header. */
const PDF_CONTENT = Buffer.from('%PDF-1.4 fake pdf content here');

describe('P4.1, P4.4, B-02–B-07, D-08, TS-01 · Медиатека', () => {
  let t: TestApp;
  let db: TestDb;
  let mediaDir: string;
  const sentCodes: { phone: string; code: string }[] = [];

  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const stubQueue: IMediaQueue = { add: () => Promise.resolve() };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      mediaDir = mkdtempSync(path.join(os.tmpdir(), 'blokum-media-test-'));
      t = await startTestApp(
        { db: db.db, otpSender, mediaQueue: stubQueue },
        { mediaDir, phoneLogin: true },
      );
    } catch {
      // PostgreSQL not available — tests skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
    try { if (mediaDir) rmSync(mediaDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  beforeEach(async () => {
    sentCodes.length = 0;
    vi.clearAllMocks();
    if (db) await db.db.delete(schema.otpRequests);
  });

  function skip() { return !t; }

  async function loginViaOtp(phone: string): Promise<string> {
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes[sentCodes.length - 1]!;
    sentCodes.length = 0;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, code })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.find((c) => c.startsWith('session='))!.split(';')[0]!;
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  it('B-02/TS-20 · POST /media — JPEG загружается, статус UPLOADED', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250001');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', JPEG_1PX, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.kind).toBe('IMAGE');
    expect(res.body.status).toBe('UPLOADED');
    expect(res.body.id).toBeTruthy();
    expect(res.body.bytes).toBe(JPEG_1PX.length);
  });

  it('B-03 · POST /media — GIF загружается как GIF', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250002');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', GIF_1PX, { filename: 'anim.gif', contentType: 'image/gif' })
      .expect(201);
    expect(res.body.kind).toBe('GIF');
  });

  it('B-07/TS-25 · POST /media — корректный Lottie JSON загружается', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250003');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', VALID_LOTTIE, { filename: 'anim.json', contentType: 'application/json' })
      .expect(201);
    expect(res.body.kind).toBe('LOTTIE');
  });

  it('TS-01 · POST /media — HTML-файл отклоняется', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250004');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', HTML_CONTENT, { filename: 'page.html', contentType: 'text/html' })
      .expect(400);
    expect(res.body.error?.code).toMatch(/FORBIDDEN_TYPE|UNKNOWN_TYPE/);
  });

  it('TS-01 · POST /media — PDF-файл отклоняется', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250005');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', PDF_CONTENT, { filename: 'doc.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect(res.body.error?.code).toBe('FORBIDDEN_TYPE');
  });

  it('TS-01 · POST /media — SVG с подменённым расширением (.jpg) отклоняется', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250006');
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', svgContent, { filename: 'image.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body.error?.code).toMatch(/FORBIDDEN_TYPE|UNKNOWN_TYPE/);
  });

  it('B-02 · POST /media — превышение лимита 5 МБ для фото → 400 FILE_TOO_LARGE', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250007');
    // A real JPEG header + padding over 5 MB.
    const oversized = Buffer.concat([JPEG_1PX, Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const res = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body.error?.code).toBe('FILE_TOO_LARGE');
  });

  // ── Chunked upload ────────────────────────────────────────────────────────

  it('P4.1 · POST /media/sessions → PUT chunk → complete → UPLOADED', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250008');

    const start = await request(t.http())
      .post(`/${API_PREFIX}/media/sessions`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ totalBytes: JPEG_1PX.length })
      .expect(201);
    const { sessionId } = start.body as { sessionId: string };
    expect(sessionId).toBeTruthy();

    await request(t.http())
      .put(`/${API_PREFIX}/media/sessions/${sessionId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .set('Content-Type', 'application/octet-stream')
      .send(JPEG_1PX)
      .expect(200);

    const complete = await request(t.http())
      .post(`/${API_PREFIX}/media/sessions/${sessionId}/complete`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(201);
    expect(complete.body.status).toBe('UPLOADED');
    expect(complete.body.kind).toBe('IMAGE');
  });

  // ── Media library ─────────────────────────────────────────────────────────

  it('P4.4/D-08 · GET /media → список файлов пользователя', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250009');
    await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', JPEG_1PX, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const list = await request(t.http())
      .get(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('D-08 · GET /media не возвращает файлы другого пользователя', async () => {
    if (skip()) return;
    const cookie1 = await loginViaOtp('+79991250010');
    const cookie2 = await loginViaOtp('+79991250011');

    await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie1)
      .set('X-Blokum-CSRF', '1')
      .attach('file', JPEG_1PX, { filename: 'user1.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const list2 = await request(t.http())
      .get(`/${API_PREFIX}/media`)
      .set('Cookie', cookie2)
      .expect(200);
    expect(list2.body.items).toHaveLength(0);
  });

  it('D-08 · DELETE /media/:id — удаляет файл без использования', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250012');
    const up = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', JPEG_1PX, { filename: 'del.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const mediaId = (up.body as { id: string }).id;

    const del = await request(t.http())
      .delete(`/${API_PREFIX}/media/${mediaId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    expect(del.body.deleted).toBe(true);

    const list = await request(t.http())
      .get(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .expect(200);
    expect((list.body.items as Array<{ id: string }>).find((i) => i.id === mediaId)).toBeUndefined();
  });

  it('D-08 · DELETE без ?confirm=true → usages возвращаются (тема использует файл)', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250013');
    const up = await request(t.http())
      .post(`/${API_PREFIX}/media`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', JPEG_1PX, { filename: 'cover.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const mediaId = (up.body as { id: string }).id;

    const [mediaRow] = await db.db
      .select({ ownerId: schema.media.ownerId })
      .from(schema.media)
      .where(eq(schema.media.id, mediaId));
    const ownerId = mediaRow!.ownerId!;

    await db.db.insert(schema.themes).values({
      id: `theme-${mediaId.slice(0, 8)}`,
      ownerId,
      name: 'Тема с обложкой',
      tokens: {},
      coverMediaId: mediaId,
      isSystem: false,
    });

    const res = await request(t.http())
      .delete(`/${API_PREFIX}/media/${mediaId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    expect(res.body.deleted).toBe(false);
    expect(Array.isArray(res.body.usages)).toBe(true);
    expect(res.body.usages.length).toBeGreaterThanOrEqual(1);
    expect((res.body.usages[0] as { kind: string }).kind).toBe('theme');
  });
});
