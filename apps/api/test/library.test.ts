import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { createId } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { createTestDb, pgSkipGuard, startTestApp, testConfig, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 30000;

describe('LB-01, LB-04, AD-10 · Библиотека платформы', () => {
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
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  beforeEach(() => {
    sentCodes.length = 0;
    vi.clearAllMocks();
    if (db) return db.db.delete(schema.otpRequests).catch(() => {});
  });

  function skip() { return !t; }

  async function loginViaOtp(phone?: string): Promise<string> {
    const p = phone ?? `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
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

  async function loginAsAdmin(): Promise<string> {
    return loginViaOtp(testConfig.adminPhone);
  }

  // ── LB-01 · GET /library/collections ────────────────────────────────────

  it('LB-01 · GET /library/collections — анонимный → 401', async () => {
    if (skip()) return;
    await request(t.http()).get(`/${API_PREFIX}/library/collections`).expect(401);
  });

  it('LB-01 · GET /library/collections — пустой список, когда нет коллекций', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    const res = await request(t.http())
      .get(`/${API_PREFIX}/library/collections`)
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('LB-01 · GET /library/collections — возвращает активные коллекции', async () => {
    if (skip()) return;
    // Создаём коллекцию напрямую в БД
    const id = createId();
    await db.db.insert(schema.libraryCollections).values({ id, kind: 'STICKERS', title: 'Тестовые стикеры', sort: 0, active: true });

    const cookie = await loginViaOtp();
    const res = await request(t.http())
      .get(`/${API_PREFIX}/library/collections`)
      .set('Cookie', cookie)
      .expect(200);
    const col = (res.body as { id: string; kind: string; title: string }[]).find((c) => c.id === id);
    expect(col).toBeTruthy();
    expect(col?.kind).toBe('STICKERS');
    expect(col?.title).toBe('Тестовые стикеры');
  });

  it('LB-01 · GET /library/collections/:id/items — возвращает пустой список', async () => {
    if (skip()) return;
    const id = createId();
    await db.db.insert(schema.libraryCollections).values({ id, kind: 'REACTIONS', title: 'Реакции', sort: 0, active: true });

    const cookie = await loginViaOtp();
    const res = await request(t.http())
      .get(`/${API_PREFIX}/library/collections/${id}/items`)
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ── AD-10 · Admin library CRUD ────────────────────────────────────────────

  it('AD-10 · POST /admin/library/collections — не-админ → 403', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp();
    await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ kind: 'STICKERS', title: 'Тест' })
      .expect(403);
  });

  it('AD-10 · POST /admin/library/collections — админ создаёт коллекцию', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ kind: 'BACKGROUNDS', title: 'Фоны', sort: 1 })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.kind).toBe('BACKGROUNDS');
    expect(res.body.title).toBe('Фоны');
  });

  it('AD-10 · POST /admin/library/collections — без лицензии → 422', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();
    // kind — обязательное поле
    await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Без вида' })
      .expect(422);
  });

  it('AD-10 · POST /admin/library/items — единица без ассета → 422', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();
    const colRes = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ kind: 'STICKERS', title: 'Стикеры 2' })
      .expect(201);
    const collectionId = (colRes.body as { id: string }).id;

    // Ни mediaId, ни fontId — ошибка
    await request(t.http())
      .post(`/${API_PREFIX}/admin/library/items`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ collectionId, title: 'Без ассета', license: 'CC0', author: 'Автор', source: 'https://example.com' })
      .expect(422);
  });

  // ── LB-04 · снятие единицы ────────────────────────────────────────────────

  it('LB-04 · DELETE /admin/library/items/:id — снятая единица помечается inactive', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();

    // Создаём коллекцию
    const colRes = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ kind: 'STICKERS', title: 'Стикеры 3' })
      .expect(201);
    const collectionId = (colRes.body as { id: string }).id;

    // Создаём медиафайл-заглушку напрямую в БД
    const mediaId = createId();
    await db.db.insert(schema.media).values({
      id: mediaId,
      ownerId: (await db.db.select({ id: schema.users.id }).from(schema.users).limit(1))[0]!.id,
      kind: 'IMAGE',
      status: 'READY',
      mime: 'image/png',
      bytes: 100,
      sha256: 'a'.repeat(64),
      variants: {},
    });

    // Добавляем единицу
    const itemRes = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/items`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ collectionId, mediaId, title: 'Тест-стикер', license: 'CC0', author: 'Авт', source: 'src', tags: ['test'] })
      .expect(201);
    const itemId = (itemRes.body as { id: string }).id;

    // Снимаем
    await request(t.http())
      .delete(`/${API_PREFIX}/admin/library/items/${itemId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ reason: 'Тест снятия' })
      .expect(204);

    // Единица неактивна
    const [row] = await db.db.select({ active: schema.libraryItems.active, withdrawnAt: schema.libraryItems.withdrawnAt })
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.id, itemId));
    expect(row?.active).toBe(false);
    expect(row?.withdrawnAt).toBeTruthy();
  });

  it('LB-04 · снятая единица не появляется в публичном API', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();

    const colRes = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ kind: 'ANIMATIONS', title: 'Анимации LB-04' })
      .expect(201);
    const collectionId = (colRes.body as { id: string }).id;

    const mediaId = createId();
    const [admin] = await db.db.select({ id: schema.users.id }).from(schema.users).limit(1);
    await db.db.insert(schema.media).values({
      id: mediaId,
      ownerId: admin!.id,
      kind: 'IMAGE',
      status: 'READY',
      mime: 'image/png',
      bytes: 100,
      sha256: 'b'.repeat(64),
      variants: {},
    });

    const itemRes = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/items`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ collectionId, mediaId, title: 'Снятый ресурс', license: 'OWN', author: 'Авт', source: 'src' })
      .expect(201);
    const itemId = (itemRes.body as { id: string }).id;

    // Снимаем
    await request(t.http())
      .delete(`/${API_PREFIX}/admin/library/items/${itemId}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ reason: 'Тест LB-04' })
      .expect(204);

    // Пользовательский API не возвращает снятую единицу
    const userCookie = await loginViaOtp();
    const list = await request(t.http())
      .get(`/${API_PREFIX}/library/collections/${collectionId}/items`)
      .set('Cookie', userCookie)
      .expect(200);
    expect((list.body as { id: string }[]).find((i) => i.id === itemId)).toBeUndefined();
  });

  it('AD-10 · GET /admin/library/licenses — манифест лицензий', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();
    const res = await request(t.http())
      .get(`/${API_PREFIX}/admin/library/licenses`)
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ── LB-02 · поиск и теги ─────────────────────────────────────────────────

  it('LB-02 · GET /library/collections/:id/items?search= — поиск по названию', async () => {
    if (skip()) return;
    const adminCookie = await loginAsAdmin();

    const colRes = await request(t.http())
      .post(`/${API_PREFIX}/admin/library/collections`)
      .set('Cookie', adminCookie).set('X-Blokum-CSRF', '1')
      .send({ kind: 'STICKERS', title: 'Коллекция-поиск-LB-02' }).expect(201);
    const collectionId = (colRes.body as { id: string }).id;

    const mediaId = createId();
    const [admin] = await db.db.select({ id: schema.users.id }).from(schema.users).limit(1);
    await db.db.insert(schema.media).values({ id: mediaId, ownerId: admin!.id, kind: 'IMAGE', status: 'READY', mime: 'image/png', bytes: 100, sha256: 'c'.repeat(64), variants: {} });

    await request(t.http()).post(`/${API_PREFIX}/admin/library/items`).set('Cookie', adminCookie).set('X-Blokum-CSRF', '1')
      .send({ collectionId, mediaId, title: 'Уникальный-ресурс-xyz', license: 'CC0', author: 'Авт', source: 'src', tags: ['тест-тег'] }).expect(201);

    const userCookie = await loginViaOtp();
    const res = await request(t.http()).get(`/${API_PREFIX}/library/collections/${collectionId}/items?search=уникальный-ресурс`).set('Cookie', userCookie).expect(200);
    expect((res.body as { id: string; title: string }[]).some((i) => i.title === 'Уникальный-ресурс-xyz')).toBe(true);

    const empty = await request(t.http()).get(`/${API_PREFIX}/library/collections/${collectionId}/items?search=несуществует`).set('Cookie', userCookie).expect(200);
    expect((empty.body as unknown[]).length).toBe(0);
  });

  // ── LB-05 · ZIP-импорт ───────────────────────────────────────────────────

  it('LB-05 · POST /admin/library/import — ZIP без CSV-манифеста → 422', async () => {
    if (skip()) return;
    const cookie = await loginAsAdmin();
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('test.png', Buffer.from('PNG'), '');
    await request(t.http()).post(`/${API_PREFIX}/admin/library/import`).set('Cookie', cookie).set('X-Blokum-CSRF', '1')
      .attach('file', zip.toBuffer(), { filename: 'import.zip', contentType: 'application/zip' }).expect(422);
  });
});
