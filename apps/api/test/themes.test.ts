import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
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

import sharp from 'sharp';
import { ThemeTokens, contrastRatio } from '@blokum/schema';

const post = (t: TestApp, cookie: string, url: string, body: unknown = {}) =>
  request(t.http()).post(`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body as object);
const put = (t: TestApp, cookie: string, url: string, body: unknown) =>
  request(t.http()).put(`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(body as object);
const get = (t: TestApp, cookie: string, url: string) => request(t.http()).get(`/${API_PREFIX}${url}`).set('Cookie', cookie);
const del = (t: TestApp, cookie: string, url: string) => request(t.http()).delete(`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');

describe('TH-01…TH-03 · темы', () => {
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

  it('TH-03 · своя тема: создать, получить, изменить, список; чужая тема недоступна', async () => {
    const created = await post(t, cookie, '/themes', { name: 'Моя тема' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Моя тема', isSystem: false, isDefault: false });
    expect(created.body.tokens.colors.primary).toMatch(/^#/);
    const id = created.body.id as string;
    const colors = { ...created.body.tokens.colors, primary: '#112233' };
    const updated = await put(t, cookie, `/themes/${id}`, { name: 'Новое имя', tokens: { ...created.body.tokens, colors } }).expect(200);
    expect(updated.body).toMatchObject({ name: 'Новое имя' });
    expect(updated.body.tokens.colors.primary).toBe('#112233');
    const list = await get(t, cookie, '/themes?scope=mine').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, name: 'Новое имя', colors: { primary: '#112233' } });
    const other = await loginViaOtp();
    await get(t, other, `/themes/${id}`).expect(404);
    await put(t, other, `/themes/${id}`, { name: 'Чужая' }).expect(404);
    await del(t, other, `/themes/${id}`).expect(404);
    await del(t, cookie, `/themes/${id}`).expect(204);
    expect((await get(t, cookie, '/themes?scope=mine').expect(200)).body).toHaveLength(0);
  });

  it('TH-01 · тема, не прошедшая проверку схемы, не сохраняется: ответ по-русски', async () => {
    const res = await post(t, cookie, '/themes', { name: 'Плохая', tokens: { colors: { primary: 'красный' } } }).expect(400);
    expect(res.body.error.code).toBe('INVALID_THEME');
    expect(res.body.error.message).toMatch(/[а-яё]/i);
    expect((await get(t, cookie, '/themes?scope=mine').expect(200)).body).toHaveLength(0);
  });

  it('TH-02 · на тарифе «Старт» своих тем не больше двух', async () => {
    await post(t, cookie, '/themes', { name: 'Одна' }).expect(201);
    await post(t, cookie, '/themes', { name: 'Две' }).expect(201);
    const third = await post(t, cookie, '/themes', { name: 'Три' }).expect(402);
    expect(third.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('TH-02 · дублирование: копия — своя тема с тем же оформлением', async () => {
    const a = await post(t, cookie, '/themes', { name: 'Исходная' }).expect(201);
    const copy = await post(t, cookie, `/themes/${a.body.id}/duplicate`).expect(201);
    expect(copy.body.name).toBe('Исходная (копия)');
    expect(copy.body.id).not.toBe(a.body.id);
    expect(copy.body.tokens).toEqual(a.body.tokens);
  });

  it('TH-03 · тема по умолчанию одна; новая сборка начинается с неё', async () => {
    const a = await post(t, cookie, '/themes', { name: 'А', tokens: { colors: { ...ThemeTokens.parse({}).colors, primary: '#AA0000' } } }).expect(201);
    const b = await post(t, cookie, '/themes', { name: 'Б' }).expect(201);
    await post(t, cookie, `/themes/${a.body.id}/default`, { value: true }).expect(200);
    await post(t, cookie, `/themes/${b.body.id}/default`, { value: true }).expect(200);
    const list = (await get(t, cookie, '/themes?scope=mine').expect(200)).body as Array<{ id: string; isDefault: boolean }>;
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([b.body.id]);
    await post(t, cookie, `/themes/${a.body.id}/default`, { value: true }).expect(200);
    const project = await post(t, cookie, '/projects', { title: 'С темой' }).expect(200);
    expect(project.body.document.theme.themeId).toBe(a.body.id);
    expect(project.body.document.theme.tokens.colors.primary).toBe('#AA0000');
    await post(t, cookie, `/themes/${a.body.id}/default`, { value: false }).expect(200);
    const plain = await post(t, cookie, '/projects', { title: 'Без темы' }).expect(200);
    expect(plain.body.document.theme.themeId).toBeUndefined();
  });

  it('TH-02 · «сохранить оформление как тему»: берутся токены черновика сборки', async () => {
    const project = await post(t, cookie, '/projects', { title: 'Оформленная' }).expect(200);
    const doc = project.body.document as { theme: { tokens: { colors: Record<string, string> } } };
    doc.theme.tokens.colors.accent = '#00AA55';
    await put(t, cookie, `/projects/${project.body.id}/draft`, { document: doc }).set('If-Match', String(project.body.draftVersionNumber)).expect(200);
    const theme = await post(t, cookie, `/themes/from-project/${project.body.id}`, { name: 'Из сборки' }).expect(201);
    expect(theme.body.name).toBe('Из сборки');
    expect(theme.body.tokens.colors.accent).toBe('#00AA55');
  });

  it('TH-02 · тема из картинки: 5–8 цветов, роли назначены, текст читается; чужая и не-картинка отклоняются', async () => {
    const stripes = await sharp({ create: { width: 90, height: 90, channels: 3, background: '#F4EFE6' } })
      .composite([
        { input: await sharp({ create: { width: 30, height: 90, channels: 3, background: '#C8321E' } }).png().toBuffer(), left: 0, top: 0 },
        { input: await sharp({ create: { width: 30, height: 90, channels: 3, background: '#1E5AA0' } }).png().toBuffer(), left: 30, top: 0 },
      ])
      .png()
      .toBuffer();
    const upload = await request(t.http()).post(`/${API_PREFIX}/media`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').attach('file', stripes, { filename: 'foto.png', contentType: 'image/png' }).expect(201);
    const res = await post(t, cookie, '/themes/from-image', { mediaId: upload.body.id, name: 'С картинки' }).expect(201);
    const colors = res.body.tokens.colors as Record<string, string>;
    const own = Object.keys(colors).filter((k) => k.startsWith('foto_'));
    expect(own.length).toBeGreaterThanOrEqual(5);
    expect(own.length).toBeLessThanOrEqual(8);
    expect(contrastRatio(colors.text!, colors.background!)).toBeGreaterThanOrEqual(4.5);
    expect(ThemeTokens.safeParse(res.body.tokens).success).toBe(true);
    const other = await loginViaOtp();
    await post(t, other, '/themes/from-image', { mediaId: upload.body.id }).expect(404);
    await post(t, cookie, '/themes/from-image', { mediaId: 'net-takogo' }).expect(404);
    await post(t, cookie, '/themes/from-image', {}).expect(400);
  });

  it('TH-03 · правка темы не трогает документы сборок: в них своя копия оформления', async () => {
    const theme = await post(t, cookie, '/themes', { name: 'Общая' }).expect(201);
    await post(t, cookie, `/themes/${theme.body.id}/default`, { value: true }).expect(200);
    const project = await post(t, cookie, '/projects', { title: 'Зависимая' }).expect(200);
    const before = (await get(t, cookie, `/projects/${project.body.id}`).expect(200)).body.document;
    await put(t, cookie, `/themes/${theme.body.id}`, { tokens: { ...theme.body.tokens, colors: { ...theme.body.tokens.colors, primary: '#0000FF' } } }).expect(200);
    const after = (await get(t, cookie, `/projects/${project.body.id}`).expect(200)).body.document;
    expect(after).toEqual(before);
    expect(after.theme.tokens.colors.primary).not.toBe('#0000FF');
  });

  it('TH-05 · системные темы: пока их нет, список пуст; опубликованная системная доступна всем для копирования', async () => {
    expect((await get(t, cookie, '/themes?scope=system').expect(200)).body).toEqual([]);
    const [sys] = await db.db
      .insert(schema.themes)
      .values({ id: 'sistemnaya_tema1', name: 'Светлая', tokens: ThemeTokens.parse({}), isSystem: true, publishedAt: new Date() })
      .returning();
    const list = (await get(t, cookie, '/themes?scope=system').expect(200)).body as Array<{ id: string }>;
    expect(list.map((x) => x.id)).toEqual([sys!.id]);
    await get(t, cookie, `/themes/${sys!.id}`).expect(200);
    await put(t, cookie, `/themes/${sys!.id}`, { name: 'Взлом' }).expect(404);
    const copy = await post(t, cookie, `/themes/${sys!.id}/duplicate`).expect(201);
    expect(copy.body).toMatchObject({ isSystem: false, name: 'Светлая (копия)' });
  });
});
