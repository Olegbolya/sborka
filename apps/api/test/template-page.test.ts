import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { createBlock, createScreen, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { sourceLabelOf } from '../src/projects/projects.service.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];

const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get' | 'delete', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const open = (t: TestApp, url: string) => request(t.http()).get(`/${API_PREFIX}${url}`);

describe('TPL-05 · «Собрать такую же»: страница шаблона, сборка-пример, метка источника', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;

  async function login(role: 'USER' | 'ADMIN' = 'USER'): Promise<{ cookie: string; id: string }> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(2000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    if (role !== 'USER') await db.db.update(schema.users).set({ role }).where(eq(schema.users.id, u!.id));
    return { cookie, id: u!.id };
  }

  async function published(cookie: string, title = 'Пример'): Promise<{ id: string; slug: string }> {
    const created = (await call(t, cookie, 'post', '/projects', { title }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, slug: created.slug };
  }

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
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

  let templateId = '';
  let example: { id: string; slug: string };

  it('TPL-05.1 · неизвестный адрес и шаблон без страницы — «Шаблон не найден», без входа; пустая галерея не мешает', async () => {
    const res = await open(t, '/templates/by-slug/net-takogo').expect(404);
    expect((res.body as { error: { code: string; message: string } }).error).toEqual({ code: 'TEMPLATE_NOT_FOUND', message: 'Шаблон не найден.' });
  });

  it('TPL-05.1 · TPL-05.3 · администратор задаёт адрес и сборку-пример; страница шаблона открывается без входа', async () => {
    const owner = await login();
    const admin = await login('ADMIN');
    example = await published(owner.cookie, 'Письмо Деду Морозу');
    const proj = await published(owner.cookie, 'Основа');
    templateId = ((await call(t, admin.cookie, 'post', '/admin/templates', { projectId: proj.id, name: 'Письмо Деду Морозу', category: 'Праздники' }).expect(201)).body as { id: string }).id;
    // Шаблон без адреса страницы не открывается.
    await open(t, '/templates/by-slug/letter-to-santa').expect(404);
    await call(t, admin.cookie, 'patch', `/admin/templates/${templateId}`, { slug: 'Плохой Адрес' }).expect(422);
    await call(t, admin.cookie, 'patch', `/admin/templates/${templateId}`, { slug: 'letter-to-santa', exampleProjectId: example.id }).expect(204);
    const page = (await open(t, '/templates/by-slug/letter-to-santa').expect(200)).body as { id: string; slug: string; name: string; category: string; example: { slug: string } | null };
    expect(page).toMatchObject({ id: templateId, slug: 'letter-to-santa', name: 'Письмо Деду Морозу', category: 'Праздники', example: { slug: example.slug } });
    // Два шаблона не делят адрес.
    const other = ((await call(t, admin.cookie, 'post', '/admin/templates', { projectId: proj.id, name: 'Другой' }).expect(201)).body as { id: string }).id;
    expect((await call(t, admin.cookie, 'patch', `/admin/templates/${other}`, { slug: 'letter-to-santa' }).expect(409)).body.error.code).toBe('SLUG_TAKEN');
  });

  it('TPL-05.3 · пример — только опубликованная сборка; пустое значение отвязывает', async () => {
    const owner = await login();
    const admin = await login('ADMIN');
    const draft = ((await call(t, owner.cookie, 'post', '/projects', { title: 'Черновик' }).expect(200)).body as { id: string }).id;
    expect((await call(t, admin.cookie, 'patch', `/admin/templates/${templateId}`, { exampleProjectId: draft }).expect(422)).body.error.message).toBe('Сборка-пример должна быть опубликована.');
    await call(t, admin.cookie, 'patch', `/admin/templates/${templateId}`, { exampleProjectId: 'net-takoj' }).expect(422);
    await call(t, admin.cookie, 'patch', `/admin/templates/${templateId}`, { exampleProjectId: '' }).expect(204);
    expect(((await open(t, '/templates/by-slug/letter-to-santa').expect(200)).body as { example: unknown }).example).toBeNull();
    await call(t, admin.cookie, 'patch', `/admin/templates/${templateId}`, { exampleProjectId: example.id }).expect(204);
  });

  it('TPL-05.2 · «Собрать такую же»: черновик — независимая копия шаблона с меткой источника; шаблон не меняется', async () => {
    const maker = await login();
    const made = (await call(t, maker.cookie, 'post', '/projects', { templateId, source: 'Serial-2.1' }).expect(200)).body as { id: string; document: ProjectDocument };
    expect(made.document.screens).toHaveLength(2);
    const [row] = await db.db.select({ sourceLabel: schema.projects.sourceLabel, sourceTemplateId: schema.projects.sourceTemplateId, ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, made.id));
    expect(row).toEqual({ sourceLabel: 'serial-2.1', sourceTemplateId: templateId, ownerId: maker.id });
    // Правка копии шаблон не трогает (TPL-04).
    const draft = (await call(t, maker.cookie, 'get', `/projects/${made.id}`).expect(200)).body as { document: ProjectDocument; draftVersionNumber: number };
    draft.document.screens.pop();
    await call(t, maker.cookie, 'put', `/projects/${made.id}/draft`, { document: draft.document }).set('If-Match', String(draft.draftVersionNumber)).expect(200);
    const [tpl] = await db.db.select({ document: schema.templates.document }).from(schema.templates).where(eq(schema.templates.id, templateId));
    expect((tpl!.document as { screens: unknown[] }).screens).toHaveLength(2);
    // Чужая или несуществующая метка не мешает собрать черновик, но не сохраняется.
    const bad = (await call(t, maker.cookie, 'post', '/projects', { templateId, source: '<script>' }).expect(200)).body as { id: string };
    const [badRow] = await db.db.select({ sourceLabel: schema.projects.sourceLabel }).from(schema.projects).where(eq(schema.projects.id, bad.id));
    expect(badRow!.sourceLabel).toBeNull();
  });

  it('TPL-05.2 · метка источника: буквы, цифры, точка, дефис, подчёркивание, до 40 знаков', () => {
    expect(sourceLabelOf('serial-2.1')).toBe('serial-2.1');
    expect(sourceLabelOf('Player')).toBe('player');
    expect(sourceLabelOf('a'.repeat(41))).toBeNull();
    expect(sourceLabelOf('-плохо')).toBeNull();
    expect(sourceLabelOf(42)).toBeNull();
    expect(sourceLabelOf(undefined)).toBeNull();
  });

  it('TPL-05.4 · кнопка в плеере — только у сборки-примера, на любом тарифе владельца; у обычной сборки её нет', async () => {
    const view = (await open(t, `/play/${example.slug}`).expect(200)).body as { state: string; buildSimilar: { slug: string } | null };
    expect(view.state).toBe('ok');
    expect(view.buildSimilar).toEqual({ slug: 'letter-to-santa' });
    const owner = await login();
    const plain = await published(owner.cookie, 'Обычная');
    expect(((await open(t, `/play/${plain.slug}`).expect(200)).body as { buildSimilar: unknown }).buildSimilar).toBeNull();
    // Тариф владельца примера не важен: на платном кнопка остаётся.
    const [ex] = await db.db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, example.id));
    await db.db.insert(schema.subscriptions).values({ userId: ex!.ownerId, planCode: 'PRO', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) }).onConflictDoNothing();
    expect(((await open(t, `/play/${example.slug}`).expect(200)).body as { buildSimilar: unknown }).buildSimilar).toEqual({ slug: 'letter-to-santa' });
  });

  it('TPL-05.4 · шаблон снят — кнопка у примера пропадает, страница шаблона не находится', async () => {
    const admin = await login('ADMIN');
    const proj = await published((await login()).cookie, 'Основа 2');
    const tid = ((await call(t, admin.cookie, 'post', '/admin/templates', { projectId: proj.id, name: 'Временный' }).expect(201)).body as { id: string }).id;
    const ex = await published((await login()).cookie, 'Пример 2');
    await call(t, admin.cookie, 'patch', `/admin/templates/${tid}`, { slug: 'temp-template', exampleProjectId: ex.id }).expect(204);
    expect(((await open(t, `/play/${ex.slug}`).expect(200)).body as { buildSimilar: unknown }).buildSimilar).toEqual({ slug: 'temp-template' });
    await call(t, admin.cookie, 'delete', `/admin/templates/${tid}`).expect(204);
    expect(((await open(t, `/play/${ex.slug}`).expect(200)).body as { buildSimilar: unknown }).buildSimilar).toBeNull();
    await open(t, '/templates/by-slug/temp-template').expect(404);
  });

  it('TPL-05.5 · админка видит, сколько черновиков собрано с каждой страницы по меткам и сколько человек прошли пример', async () => {
    const admin = await login('ADMIN');
    const maker = await login();
    await call(t, maker.cookie, 'post', '/projects', { templateId, source: 'serial-2.1' }).expect(200);
    await call(t, maker.cookie, 'post', '/projects', { templateId, source: 'serial-1.3' }).expect(200);
    await db.db.insert(schema.participantSessions).values({ projectId: example.id, versionId: (await db.db.select({ v: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, example.id)))[0]!.v!, status: 'COMPLETED', completedAt: new Date() });
    const rows = (await call(t, admin.cookie, 'get', '/admin/templates/sources').expect(200)).body as Array<{ id: string; slug: string; examplePassages: number; drafts: number; byLabel: Array<{ label: string; drafts: number }> }>;
    const mine = rows.find((r) => r.id === templateId)!;
    expect(mine.slug).toBe('letter-to-santa');
    expect(mine.examplePassages).toBe(1);
    expect(mine.drafts).toBe(4);
    expect(mine.byLabel).toEqual(expect.arrayContaining([{ label: 'serial-2.1', drafts: 2 }, { label: 'serial-1.3', drafts: 1 }]));
    const user = await login();
    await call(t, user.cookie, 'get', '/admin/templates/sources').expect(403);
  });
});
