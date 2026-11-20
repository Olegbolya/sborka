import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { QUESTIONS_PER_DAY } from '../src/support/support.service.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

describe('AD-13 · вопросы в поддержку со страницы «Помощь»', () => {
  let db: TestDb;
  let t: TestApp;
  let phone = 0;
  const otp: OtpSender & { codes: Array<{ phone: string; code: string }> } = {
    codes: [],
    sendCode(p: string, code: string) {
      this.codes.push({ phone: p, code });
      return Promise.resolve();
    },
  };
  const captcha: CaptchaVerifier = { verify: () => Promise.resolve(true) };
  async function login(): Promise<{ cookie: string; userId: string }> {
    await db.db.delete(schema.otpRequests);
    const p = `+7903${String(4000000 + ++phone)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: p, captchaToken: 'ok' }).expect(200);
    const { code } = otp.codes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone: p, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, p));
    return { cookie, userId: u!.id };
  }
  const call = (method: 'get' | 'post', path: string, cookie?: string, body?: object) => {
    const r = request(t.http())[method](`/${API_PREFIX}${path}`).set('X-Blokum-CSRF', '1');
    if (cookie) r.set('Cookie', cookie);
    return body ? r.send(body) : r;
  };

  beforeAll(async () => {
    db = await createTestDb();
    t = await startTestApp({ db: db.db, otpSender: otp, captchaVerifier: captcha }, { phoneLogin: true });
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('AD-13 · вопрос задаёт только вошедший; текст проверяется; свои вопросы видны под формой', async () => {
    await call('post', '/support/questions', undefined, { text: 'Как вставить видео на фон экрана?' }).expect(401);
    const u = await login();
    expect((await call('post', '/support/questions', u.cookie, { text: 'коротко' }).expect(400)).body.error.message).toContain('от 10 до 2000');
    await call('post', '/support/questions', u.cookie, { text: 'x'.repeat(2001) }).expect(400);
    const asked = await call('post', '/support/questions', u.cookie, { text: '  Как вставить видео на фон экрана?  ' }).expect(201);
    expect(asked.body).toMatchObject({ text: 'Как вставить видео на фон экрана?', status: 'NEW', answer: null });
    const mine = (await call('get', '/support/questions', u.cookie).expect(200)).body as { questions: Array<{ text: string }> };
    expect(mine.questions.map((q) => q.text)).toEqual(['Как вставить видео на фон экрана?']);
    const other = await login();
    expect(((await call('get', '/support/questions', other.cookie).expect(200)).body as { questions: unknown[] }).questions).toEqual([]);
  });

  it(`AD-13 · не больше ${QUESTIONS_PER_DAY} вопросов за сутки от одного человека — понятный отказ`, async () => {
    const u = await login();
    for (let i = 0; i < QUESTIONS_PER_DAY; i++) await call('post', '/support/questions', u.cookie, { text: `Вопрос номер ${String(i + 1)} про сборку` }).expect(201);
    const refused = await call('post', '/support/questions', u.cookie, { text: 'Ещё один вопрос про сборку' }).expect(429);
    expect(refused.body.error.code).toBe('TOO_MANY_QUESTIONS');
  });

  it('AD-13 · вопросы приходят в админку; ответ уходит человеку в кабинет, второй раз ответить нельзя; закрыть без ответа; всё в журнале', async () => {
    const u = await login();
    const q = (await call('post', '/support/questions', u.cookie, { text: 'Почему не открывается мой тест по ссылке?' }).expect(201)).body as { id: string };
    const admin = await login();
    await call('get', '/admin/support', u.cookie).expect(403);
    await db.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.id, admin.userId));
    const list = (await call('get', '/admin/support', admin.cookie).expect(200)).body as { questions: Array<{ id: string; userName: string; text: string }>; open: number };
    expect(list.questions.find((x) => x.id === q.id)).toMatchObject({ text: 'Почему не открывается мой тест по ссылке?' });
    expect(list.open).toBeGreaterThanOrEqual(1);
    await call('post', `/admin/support/${q.id}/answer`, admin.cookie, { answer: '' }).expect(400);
    await call('post', `/admin/support/${q.id}/answer`, admin.cookie, { answer: 'Сборка была не опубликована — нажмите «Опубликовать».' }).expect(200);
    await call('post', `/admin/support/${q.id}/answer`, admin.cookie, { answer: 'Ещё раз' }).expect(409);
    const notices = await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, u.userId), eq(schema.notifications.kind, `support:${q.id}`)));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: 'Ответ на ваш вопрос' });
    expect(notices[0]!.body).toContain('Сборка была не опубликована');
    const mine = (await call('get', '/support/questions', u.cookie).expect(200)).body as { questions: Array<{ status: string; answer: string }> };
    expect(mine.questions[0]).toMatchObject({ status: 'ANSWERED', answer: 'Сборка была не опубликована — нажмите «Опубликовать».' });
    const spam = (await call('post', '/support/questions', u.cookie, { text: 'Купите рекламу на моём сайте недорого' }).expect(201)).body as { id: string };
    await call('post', `/admin/support/${spam.id}/close`, admin.cookie).expect(200);
    expect(((await call('get', '/admin/support?status=CLOSED', admin.cookie).expect(200)).body as { questions: Array<{ id: string }> }).questions.map((x) => x.id)).toContain(spam.id);
    const audit = await db.db.select({ action: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.actorId, admin.userId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['SUPPORT_ANSWERED', 'SUPPORT_CLOSED']));
  });
});
