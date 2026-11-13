import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

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

import { createBlock, createDocument, createScreen, textOf } from '@blokum/schema';

describe('TPL-01/TPL-02 · свои шаблоны (сохранить, список, переименовать, удалить)', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let cookie: string;

  beforeAll(async () => {
    try {
      let loginViaOtp: (phone?: string) => Promise<string>;
      ({ t, db, loginViaOtp } = await makeAppWithAuth());
      cookie = await loginViaOtp();
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  const get = (path: string) => request(t.http()).get(`/${API_PREFIX}${path}`).set('Cookie', cookie);
  const post = (path: string, body: object) => request(t.http()).post(`/${API_PREFIX}${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body);
  const patch = (path: string, body: object) => request(t.http()).patch(`/${API_PREFIX}${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body);
  const del = (path: string) => request(t.http()).delete(`/${API_PREFIX}${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');

  let projectId: string;
  let templateId: string;

  it('подготовка — создать сборку с содержимым', async () => {
    const res = await post('/projects', { title: 'Исходная сборка' }).expect(200);
    projectId = (res.body as { id: string }).id;
  });

  it('TPL-01 · POST /templates — сохранить сборку как свой шаблон', async () => {
    const res = await post('/templates', { projectId, name: 'Мой шаблон-тест' }).expect(200);
    const body = res.body as { id: string };
    expect(typeof body.id).toBe('string');
    templateId = body.id;
  });

  it('TPL-02 · GET /templates/mine — свои шаблоны не попадают в системную галерею', async () => {
    const own = await get('/templates/mine').expect(200);
    const ownIds = (own.body as { templates: Array<{ id: string; isSystem: boolean }> }).templates;
    expect(ownIds.some((t) => t.id === templateId)).toBe(true);
    expect(ownIds.every((t) => t.isSystem === false)).toBe(true);
    const gallery = await get('/templates').expect(200);
    const galleryIds = (gallery.body as { templates: Array<{ id: string }> }).templates.map((t) => t.id);
    expect(galleryIds).not.toContain(templateId);
  });

  it('TPL-02 · PATCH /templates/:id — переименовать свой шаблон', async () => {
    await patch(`/templates/${templateId}`, { name: 'Переименованный' }).expect(200);
    const res = await get('/templates/mine').expect(200);
    const found = (res.body as { templates: Array<{ id: string; name: string }> }).templates.find((t) => t.id === templateId);
    expect(found?.name).toBe('Переименованный');
  });

  it('TPL-02 · GET /templates/:id — экраны и переменные шаблона для вставки отдельного экрана; чужого и несуществующего нет', async () => {
    const res = await get(`/templates/${templateId}`).expect(200);
    const body = res.body as { id: string; name: string; screens: Array<{ id: string; name: string }>; variables: unknown[] };
    expect(body.id).toBe(templateId);
    expect(body.screens.length).toBeGreaterThan(0);
    expect(Array.isArray(body.variables)).toBe(true);
    await get('/templates/net-takogo-shablona').expect(404);
  });

  it('TPL-02 · PATCH /templates/:id — обложка: своё изображение из библиотеки, чужой или выдуманный файл — отказ, null снимает', async () => {
    const [p] = await db.db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, projectId));
    const [m] = await db.db.insert(schema.media).values({ ownerId: p!.ownerId, kind: 'IMAGE', mime: 'image/png', bytes: 10, sha256: 'c'.repeat(64), status: 'READY' }).returning();
    await patch(`/templates/${templateId}`, { coverMediaId: m!.id }).expect(200);
    const withCover = await get('/templates/mine').expect(200);
    expect((withCover.body as { templates: Array<{ id: string; coverMediaId: string | null }> }).templates.find((x) => x.id === templateId)?.coverMediaId).toBe(m!.id);
    const bad = await patch(`/templates/${templateId}`, { coverMediaId: 'chuzhoj-fajl' }).expect(400);
    expect((bad.body as { error: { code: string } }).error.code).toBe('INVALID_COVER');
    await patch(`/templates/${templateId}`, { coverMediaId: null }).expect(200);
    const without = await get('/templates/mine').expect(200);
    expect((without.body as { templates: Array<{ id: string; coverMediaId: string | null }> }).templates.find((x) => x.id === templateId)?.coverMediaId).toBeNull();
    await patch(`/templates/${templateId}`, {}).expect(400);
  });

  it('TPL-04 · POST /projects с templateId своего шаблона — независимая копия', async () => {
    const res = await post('/projects', { templateId }).expect(200);
    const newId = (res.body as { id: string }).id;
    expect(newId).not.toBe(projectId);
    // шаблон ещё на месте
    const mine = await get('/templates/mine').expect(200);
    expect((mine.body as { templates: Array<{ id: string }> }).templates.some((t) => t.id === templateId)).toBe(true);
  });

  it('TPL-02 · DELETE /templates/:id — удалить свой шаблон', async () => {
    await del(`/templates/${templateId}`).expect(204);
    const res = await get('/templates/mine').expect(200);
    expect((res.body as { templates: Array<{ id: string }> }).templates.some((t) => t.id === templateId)).toBe(false);
  });

  it('TPL-01 · аноним → 401', async () => {
    await request(t.http()).post(`/${API_PREFIX}/templates`).set('X-Blokum-CSRF', '1').send({ projectId }).expect(401);
    await request(t.http()).get(`/${API_PREFIX}/templates/mine`).expect(401);
  });
});

describe('P10.2 · TPL-03/TPL-04 · сборка из системного шаблона и пустая галерея', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let cookie: string;

  beforeAll(async () => {
    try {
      let loginViaOtp: (phone?: string) => Promise<string>;
      ({ t, db, loginViaOtp } = await makeAppWithAuth());
      cookie = await loginViaOtp();
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  const get = (path: string) => request(t.http()).get(`/${API_PREFIX}${path}`).set('Cookie', cookie);
  const post = (path: string, body: object) => request(t.http()).post(`/${API_PREFIX}${path}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body);

  it('P10.2 · на старте галерея содержит 14 системных шаблонов TPL-03, а сборка «с нуля» создаётся как обычно', async () => {
    // После P10.4 SystemTemplatesService засевает 14 стартовых шаблонов: 4 бытовых + RG-01…RG-10.
    const list = await get('/templates').expect(200);
    const starter = (list.body as { templates: Array<{ id: string }> }).templates;
    expect(starter.length).toBe(14);
    expect(starter.every((t) => t.id.startsWith('sys-tpl-'))).toBe(true);
    const made = await post('/projects', { title: 'С нуля' }).expect(200);
    const body = made.body as { title: string; document: { screens: unknown[] } };
    expect(body.title).toBe('С нуля');
    expect(body.document.screens).toHaveLength(1);
  });

  it('P10.2 · TPL-03: галерея показывает системные шаблоны, но не снятые и не чужие', async () => {
    const doc = createDocument({ title: 'Поздравление' });
    doc.screens[0]!.blocks.push(createBlock('text', { textLayer: textOf('Поздравляю!') }));
    const [on] = await db.db.insert(schema.templates).values({ name: 'Поздравление', category: 'Праздники', document: doc as never, isSystem: true, sort: 1, publishedAt: new Date() }).returning();
    await db.db.insert(schema.templates).values({ name: 'Снятый', document: doc as never, isSystem: true, deletedAt: new Date() });
    await db.db.insert(schema.templates).values({ name: 'Личный', document: doc as never, isSystem: false });
    const list = await get('/templates').expect(200);
    const names = (list.body as { templates: Array<{ id: string; name: string }> }).templates.map((x) => x.name);
    // В галерее — новый «Поздравление» и 14 стартовых; снятый и личный не видны.
    expect(names).toContain('Поздравление');
    expect(names).not.toContain('Снятый');
    expect(names).not.toContain('Личный');
    expect(names.length).toBe(15);
    const ids = (list.body as { templates: Array<{ id: string }> }).templates.map((x) => x.id);
    expect(ids).toContain(on!.id);
  });

  it('P10.2 · TPL-04: сборка из шаблона — полная независимая копия; правка шаблона потом не меняет созданную сборку', async () => {
    const [tpl] = await db.db.select().from(schema.templates).where(eq(schema.templates.name, 'Поздравление'));
    const made = await post('/projects', { templateId: tpl!.id }).expect(200);
    const project = made.body as { id: string; title: string; document: { screens: Array<{ blocks: Array<{ textLayer?: { paragraphs: Array<{ runs: Array<{ t: string }> }> } }> }> } };
    expect(project.title).toBe('Поздравление');
    expect(project.document.screens[0]!.blocks[0]!.textLayer!.paragraphs[0]!.runs[0]!.t).toBe('Поздравляю!');
    const changed = createDocument({ title: 'Поздравление' });
    changed.screens[0]!.blocks.push(createBlock('text', { textLayer: textOf('Другой текст') }));
    changed.screens.push(createScreen('Ещё'));
    await db.db.update(schema.templates).set({ document: changed }).where(eq(schema.templates.id, tpl!.id));
    const again = await get(`/projects/${project.id}`).expect(200);
    const stored = (again.body as { document: { screens: Array<{ blocks: Array<{ textLayer?: { paragraphs: Array<{ runs: Array<{ t: string }> }> } }> }> } }).document;
    expect(stored.screens).toHaveLength(1);
    expect(stored.screens[0]!.blocks[0]!.textLayer!.paragraphs[0]!.runs[0]!.t).toBe('Поздравляю!');
  });

  it('P10.2 · неизвестный, снятый и личный шаблон — «не найден», сборка не создаётся', async () => {
    const before = ((await get('/projects').expect(200)).body as unknown[]).length;
    const rows = await db.db.select().from(schema.templates);
    const invalid = [{ id: 'net-takogo' }, ...rows.filter((x) => x.name === 'Снятый' || x.name === 'Личный')];
    for (const r of invalid) await post('/projects', { templateId: r.id }).expect(404);
    expect(((await get('/projects').expect(200)).body as unknown[]).length).toBe(before);
  });
});
