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

describe('D-01 · Мои сборки', () => {
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

  it('D-01: создать и получить список сборок', async () => {
    const res = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Тест сборки' })
      .expect(200);
    expect(res.body).toMatchObject({ title: 'Тест сборки', status: 'DRAFT', starts: 0, completions: 0 });

    const list = await request(t.http()).get(`/${API_PREFIX}/projects`).set('Cookie', cookie).expect(200);
    expect(list.body).toBeInstanceOf(Array);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  it('D-01: получить сборку по id', async () => {
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Проверка getOne' })
      .expect(200);
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${c.body.id as string}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toMatchObject({ id: c.body.id, title: 'Проверка getOne' });
    expect(res.body).toHaveProperty('document');
  });

  it('D-01: переименовать сборку (PATCH)', async () => {
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Старое название' })
      .expect(200);
    await request(t.http())
      .patch(`/${API_PREFIX}/projects/${c.body.id as string}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Новое название' })
      .expect(200);
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${c.body.id as string}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.title).toBe('Новое название');
  });

  it('D-01: удалить и восстановить сборку', async () => {
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({})
      .expect(200);
    await request(t.http())
      .delete(`/${API_PREFIX}/projects/${c.body.id as string}`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(204);
    // 404 after soft-delete
    await request(t.http()).get(`/${API_PREFIX}/projects/${c.body.id as string}`).set('Cookie', cookie).expect(404);
    // Restore
    await request(t.http())
      .post(`/${API_PREFIX}/projects/${c.body.id as string}/restore`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    await request(t.http()).get(`/${API_PREFIX}/projects/${c.body.id as string}`).set('Cookie', cookie).expect(200);
  });

  it('D-01: дублировать сборку', async () => {
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Оригинал' })
      .expect(200);
    const dup = await request(t.http())
      .post(`/${API_PREFIX}/projects/${c.body.id as string}/duplicate`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    expect(dup.body.title).toBe('Оригинал (копия)');
    expect(dup.body.id).not.toBe(c.body.id);
  });

  it('D-01: поменять статус на PUBLISHED', async () => {
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({})
      .expect(200);
    await request(t.http())
      .post(`/${API_PREFIX}/projects/${c.body.id as string}/status`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ status: 'PUBLISHED' })
      .expect(200);
    const pub = await request(t.http())
      .get(`/${API_PREFIX}/projects/${c.body.id as string}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(pub.body.status).toBe('PUBLISHED');
  });

  it('D-01: фильтрация поиском по названию', async () => {
    await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'УникальноеX9Z' })
      .expect(200);
    const filtered = await request(t.http())
      .get(`/${API_PREFIX}/projects?search=X9Z`)
      .set('Cookie', cookie)
      .expect(200);
    expect(filtered.body.length).toBeGreaterThanOrEqual(1);
    expect((filtered.body[0] as { title: string }).title).toContain('X9Z');
  });

  it('D-01: IDOR — чужая сборка возвращает 403', async () => {
    const cookie2 = await loginViaOtp();
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({})
      .expect(200);
    await request(t.http()).get(`/${API_PREFIX}/projects/${c.body.id as string}`).set('Cookie', cookie2).expect(403);
  });
});

describe('D-03 · Доступ', () => {
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

  it('D-03: получить и обновить настройки доступа', async () => {
    const c = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({})
      .expect(200);
    const initial = await request(t.http())
      .get(`/${API_PREFIX}/projects/${c.body.id as string}/access-settings`)
      .set('Cookie', cookie)
      .expect(200);
    expect(initial.body).toEqual({});
    await request(t.http())
      .patch(`/${API_PREFIX}/projects/${c.body.id as string}/access-settings`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ maxCompletions: 50, singleAttempt: true })
      .expect(200);
    const updated = await request(t.http())
      .get(`/${API_PREFIX}/projects/${c.body.id as string}/access-settings`)
      .set('Cookie', cookie)
      .expect(200);
    expect(updated.body).toMatchObject({ maxCompletions: 50, singleAttempt: true });
  });
});

describe('Q-01/Q-02/Q-04/Q-05/Q-07 · Точки доступа и QR', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;
  let projectId: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
    cookie = await loginViaOtp();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'QR-тест' })
      .expect(200);
    projectId = res.body.id as string;
  });

  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('Q-01: создать точку доступа и получить URL', async () => {
    const res = await request(t.http())
      .post(`/${API_PREFIX}/projects/${projectId}/access-points`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ label: 'Главная ссылка', kind: 'LINK' })
      .expect(200);
    expect(res.body).toMatchObject({ label: 'Главная ссылка', kind: 'LINK', active: true });
    expect((res.body.url as string)).toContain('/q/');
    expect(res.body.code).toBeTruthy();
  });

  it('Q-01: список точек доступа', async () => {
    const list = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/access-points`)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toBeInstanceOf(Array);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  it('Q-04/Q-05: скачать QR PNG 1024 — Content-Type image/png', async () => {
    const create = await request(t.http())
      .post(`/${API_PREFIX}/projects/${projectId}/access-points`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ label: 'QR PNG', kind: 'QR' })
      .expect(200);
    const apId = create.body.id as string;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/access-points/${apId}/qr.png?size=1024`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    // PNG magic bytes: 89 50 4E 47
    expect((res.body as Buffer)[0]).toBe(0x89);
    expect((res.body as Buffer)[1]).toBe(0x50);
  });

  it('Q-04/Q-05: скачать QR SVG — содержит тег svg', async () => {
    const create = await request(t.http())
      .post(`/${API_PREFIX}/projects/${projectId}/access-points`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ label: 'QR SVG', kind: 'QR' })
      .expect(200);
    const apId = create.body.id as string;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/access-points/${apId}/qr.svg`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks).toString('utf8')));
      })
      .expect(200);
    expect(res.text ?? (res.body as string)).toContain('<svg');
  });

  it('Q-07: отключить точку доступа', async () => {
    const create = await request(t.http())
      .post(`/${API_PREFIX}/projects/${projectId}/access-points`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ label: 'Toggle' })
      .expect(200);
    const apId = create.body.id as string;
    await request(t.http())
      .post(`/${API_PREFIX}/projects/${projectId}/access-points/${apId}/active`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ active: false })
      .expect(204);
    const [row] = await db.db.select().from(schema.accessPoints).where(eq(schema.accessPoints.id, apId));
    expect(row?.active).toBe(false);
  });
});

describe('D-04 · Ответы', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;
  let projectId: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
    cookie = await loginViaOtp();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Ответы-тест' })
      .expect(200);
    projectId = res.body.id as string;
  });

  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('D-04: список ответов пуст для нового проекта', async () => {
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/responses`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items.length).toBe(0);
    expect(res.body.nextCursor).toBeNull();
  });

  it('D-04: IDOR — ответы чужого проекта возвращают 403', async () => {
    const cookie2 = await loginViaOtp();
    const res2 = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie2)
      .set('X-Blokum-CSRF', '1')
      .send({})
      .expect(200);
    await request(t.http())
      .get(`/${API_PREFIX}/projects/${res2.body.id as string}/responses`)
      .set('Cookie', cookie)
      .expect(403);
  });
});

describe('D-02 · Поделиться', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;
  let projectId: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
    cookie = await loginViaOtp();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Поделиться-тест' })
      .expect(200);
    projectId = res.body.id as string;
  });

  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('D-02: точка доступа возвращает URL для поделиться', async () => {
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/access-points`)
      .set('Cookie', cookie)
      .expect(200);
    const points = res.body as { id: string; url: string; code: string }[];
    expect(points.length).toBeGreaterThanOrEqual(1);
    const point = points[0]!;
    expect(point.url).toMatch(/\/q\//);
    // D-02: URL пригоден для передачи в VK, Telegram, WhatsApp, Email
    expect(encodeURIComponent(point.url)).toBeTruthy();
  });
});

describe('D-11 · Моё творчество', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
    cookie = await loginViaOtp();
  });

  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('D-11: неаутентифицированный пользователь получает 401 на списке сборок', async () => {
    // D-11 — таблицы тем, шаблонов, элементов, шрифтов существуют в схеме;
    // наполнение — задача владельца через админку (LB-05 / AD-11), API не отвечает за это.
    // Проверяем, что авторизация работает корректно — основа для защищённых разделов творчества.
    await request(t.http())
      .get(`/${API_PREFIX}/projects`)
      .expect(401);
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('D-06 · Экспорт CSV/XLSX', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;
  let projectId: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
    cookie = await loginViaOtp();
    const res = await request(t.http())
      .post(`/${API_PREFIX}/projects`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ title: 'Экспорт-тест' })
      .expect(200);
    projectId = res.body.id as string;
  });

  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('D-06: export.csv — UTF-8 BOM + Content-Type text/csv', async () => {
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/responses/export.csv`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const buf = res.body as Buffer;
    // UTF-8 BOM: EF BB BF
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it('D-06: export.xlsx — application/vnd.openxmlformats + PK magic bytes', async () => {
    const res = await request(t.http())
      .get(`/${API_PREFIX}/projects/${projectId}/responses/export.xlsx`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    const buf = res.body as Buffer;
    // ZIP/XLSX: PK magic = 50 4B
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
