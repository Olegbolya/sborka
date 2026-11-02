import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/** Буфер с валидным TTF-заголовком, но мусорным содержимым — fontkit не сможет прочитать. */
const BROKEN_TTF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]), // TTF magic
  Buffer.alloc(256, 0xaa),               // мусор
]);

/** Буфер, превышающий 10 МБ с TTF-заголовком. */
const BIG_TTF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(10 * 1024 * 1024 + 1, 0x00),
]);

/** Ищет файл Geist-Regular.ttf в node_modules/.pnpm и возвращает путь или null. */
async function findGeistTtf(): Promise<string | null> {
  // Ищем от корня монорепо
  const repoRoot = path.resolve(process.cwd(), '../../');
  const pattern = 'node_modules/.pnpm/next@*/node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf';
  try {
    const matches: string[] = [];
    for await (const match of glob(pattern, { cwd: repoRoot })) {
      matches.push(path.resolve(repoRoot, match));
    }
    if (matches.length > 0) return matches[0]!;
  } catch {
    // glob недоступен или путь не найден
  }
  // Пробуем напрямую от текущей директории
  try {
    const matches: string[] = [];
    for await (const match of glob(pattern, { cwd: process.cwd() })) {
      matches.push(path.resolve(process.cwd(), match));
    }
    if (matches.length > 0) return matches[0]!;
  } catch {
    // ignore
  }
  return null;
}

let phoneCounter = 10000;

describe('TH-04, TS-26 · пользовательские шрифты', () => {
  let t: TestApp;
  let db: TestDb;
  let mediaDir: string;
  let geistPath: string | null = null;
  const sentCodes: { phone: string; code: string }[] = [];

  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };

  beforeAll(async () => {
    geistPath = await findGeistTtf();
    try {
      db = await createTestDb();
      mediaDir = mkdtempSync(path.join(os.tmpdir(), 'blokum-fonts-test-'));
      t = await startTestApp({ db: db.db, otpSender }, { mediaDir, phoneLogin: true });
    } catch {
      // PostgreSQL недоступен — тесты пропускаются
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
    try { if (mediaDir) rmSync(mediaDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  beforeEach(() => {
    sentCodes.length = 0;
    vi.clearAllMocks();
  });

  function skip() { return !t; }
  function skipNoFont() { return !t || !geistPath; }

  async function loginViaOtp(): Promise<string> {
    if (db) await db.db.delete(schema.otpRequests).catch(() => {});
    const phone = `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
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

  it('TH-04 · POST /fonts — отклоняет слишком большой файл (>10 МБ)', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', BIG_TTF, { filename: 'big.ttf', contentType: 'application/octet-stream' });
    // NestJS FileInterceptor returns 413 (multer LIMIT_FILE_SIZE) or 400 (processFont check)
    expect([400, 413]).toContain(res.status);
  });

  it('TH-04 · POST /fonts — отклоняет битый файл (TTF-заголовок, мусор внутри)', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', BROKEN_TTF, { filename: 'broken.ttf', contentType: 'application/octet-stream' })
      .expect(400);
    expect(res.body.error?.code).toMatch(/FONT_BROKEN|FONT_INVALID_FORMAT|FONT_CONVERSION_FAILED/);
    expect(res.body.error?.message).toMatch(/[а-яё]/i);
  });

  it('TH-04 · POST /fonts — принимает шрифт и возвращает hasCyrillic', async () => {
    if (skipNoFont()) return;
    const cookie = await loginViaOtp();
    const buf = await readFile(geistPath!);
    const res = await request(t.http())
      .post(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', buf, { filename: 'Geist-Regular.ttf', contentType: 'application/octet-stream' })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.family).toBeTruthy();
    expect(typeof res.body.styles).toBe('object');
    expect(Object.keys(res.body.styles as Record<string, unknown>).length).toBeGreaterThan(0);
    expect(typeof res.body.hasCyrillic).toBe('boolean');
  });

  it('TH-04 · GET /fonts — возвращает список шрифтов', async () => {
    if (skipNoFont()) return;
    const cookie = await loginViaOtp();
    const buf = await readFile(geistPath!);
    // Загружаем шрифт
    await request(t.http())
      .post(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', buf, { filename: 'Geist-Regular.ttf', contentType: 'application/octet-stream' })
      .expect(201);
    const list = await request(t.http())
      .get(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
    const font = list.body[0] as { id: string; family: string; styles: Record<string, unknown>; hasCyrillic: boolean; createdAt: string };
    expect(font.id).toBeTruthy();
    expect(font.family).toBeTruthy();
    expect(font.createdAt).toBeTruthy();
  });

  it('TH-04 · DELETE /fonts/:id — удаляет шрифт', async () => {
    if (skipNoFont()) return;
    const cookie = await loginViaOtp();
    const buf = await readFile(geistPath!);
    const created = await request(t.http())
      .post(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', buf, { filename: 'Geist-Regular.ttf', contentType: 'application/octet-stream' })
      .expect(201);
    const fontId = (created.body as { id: string }).id;
    await request(t.http())
      .delete(`/${API_PREFIX}/fonts/${fontId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(204);
    const list = await request(t.http())
      .get(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .expect(200);
    expect((list.body as Array<{ id: string }>).find((f) => f.id === fontId)).toBeUndefined();
    // Повторное удаление — 404
    await request(t.http())
      .delete(`/${API_PREFIX}/fonts/${fontId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(404);
  });

  it('TS-26 · POST /fonts — конвертирует в WOFF2 и сохраняет как медиафайл', async () => {
    if (skipNoFont()) return;
    const cookie = await loginViaOtp();
    const buf = await readFile(geistPath!);
    const res = await request(t.http())
      .post(`/${API_PREFIX}/fonts`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .attach('file', buf, { filename: 'Geist-Regular.ttf', contentType: 'application/octet-stream' })
      .expect(201);
    // Проверяем, что стили содержат mediaId
    const font = res.body as { id: string; styles: Record<string, { mediaId: string }> };
    expect(Object.keys(font.styles).length).toBeGreaterThan(0);
    const [firstStyle] = Object.values(font.styles);
    expect(firstStyle?.mediaId).toBeTruthy();
    // Проверяем, что медиафайл создан как FONT_SOURCE/READY в БД
    if (db) {
      const { schema: dbSchema } = await import('@blokum/db');
      const { eq } = await import('drizzle-orm');
      const mediaId = firstStyle!.mediaId;
      const [mediaRow] = await db.db
        .select({ kind: dbSchema.media.kind, status: dbSchema.media.status, mime: dbSchema.media.mime })
        .from(dbSchema.media)
        .where(eq(dbSchema.media.id, mediaId));
      expect(mediaRow?.kind).toBe('FONT_SOURCE');
      expect(mediaRow?.status).toBe('READY');
      expect(mediaRow?.mime).toBe('font/woff2');
    }
  });
});
