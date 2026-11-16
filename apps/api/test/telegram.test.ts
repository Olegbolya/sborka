import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { PassageNoticesService, telegramAnswers } from '../src/play/passage-notices.service.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const SECRET = 'webhook-secret-for-tests';
const BOT = { token: '123456:TEST', botUsername: 'blokker_test_bot', webhookSecret: SECRET };
let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];

describe('D-07 · Telegram-бот: привязка чата, вебхук, сообщения о прохождениях', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let off: TestApp;
  let db: TestDb;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let nextStatus = 200;

  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return Promise.resolve({ ok: nextStatus < 400, status: nextStatus });
  };

  const login = async (app: TestApp): Promise<{ cookie: string; id: string }> => {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(4000000 + ++phoneCounter).slice(-7)}`;
    await request(app.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(app.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const me = (await request(app.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200)).body as { id: string };
    return { cookie, id: me.id };
  };
  const api = (app: TestApp, cookie: string, method: 'get' | 'post' | 'delete', url: string) => request(app.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  const webhook = (body: unknown, secret: string | null = SECRET) => {
    const r = request(t.http()).post(`/${API_PREFIX}/telegram/webhook`);
    return (secret ? r.set('X-Telegram-Bot-Api-Secret-Token', secret) : r).send(body as object);
  };
  const subscribe = (userId: string, planCode: string) =>
    db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });
  const startMessage = (chatId: number, text: string, type = 'private') => ({ update_id: 1, message: { message_id: 1, text, chat: { id: chatId, type } } });
  const linkOf = async (userId: string) => (await db.db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)))[0];

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier, telegramFetch: fetchFn }, { phoneLogin: true, telegram: BOT });
      off = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { phoneLogin: true });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await off?.app.close();
    await db?.drop();
  });

  it('D-07 · бот не подключён: «Настройки» это показывают, привязать нельзя', async () => {
    const u = await login(off);
    const st = (await api(off, u.cookie, 'get', '/account/telegram').expect(200)).body as { configured: boolean; linked: boolean };
    expect(st).toMatchObject({ configured: false, linked: false });
    const res = await api(off, u.cookie, 'post', '/account/telegram/link').expect(503);
    expect(res.body.error.message).toBe('Бот для Телеграма ещё не подключён.');
  });

  it('D-07 · на тарифе «Старт» привязать нельзя: нужен «Про»', async () => {
    const u = await login(t);
    const st = (await api(t, u.cookie, 'get', '/account/telegram').expect(200)).body as { configured: boolean; allowed: boolean };
    expect(st).toMatchObject({ configured: true, allowed: false });
    await api(t, u.cookie, 'post', '/account/telegram/link').expect(402);
  });

  it('D-07 · «Про»: ссылка с одноразовым словом → /start в боте привязывает чат; чужой секрет, чужое слово и группы не привязывают', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const { url } = (await api(t, u.cookie, 'post', '/account/telegram/link').expect(200)).body as { url: string };
    const code = /start=([a-f0-9]{24})$/.exec(url)![1]!;
    expect(url.startsWith('https://t.me/blokker_test_bot?start=')).toBe(true);

    // Not Telegram (no secret, wrong secret): nothing happens.
    calls.length = 0;
    expect((await webhook(startMessage(555, `/start ${code}`), null).expect(200)).body).toEqual({ ok: false });
    expect((await webhook(startMessage(555, `/start ${code}`), 'wrong').expect(200)).body).toEqual({ ok: false });
    expect(await linkOf(u.id)).toBeUndefined();
    // A group chat does not link.
    await webhook(startMessage(-100, `/start ${code}`, 'group')).expect(200);
    expect(await linkOf(u.id)).toBeUndefined();
    // An unknown word gets a hint, not a link.
    await webhook(startMessage(555, `/start ${'0'.repeat(24)}`)).expect(200);
    expect(await linkOf(u.id)).toBeUndefined();
    expect(String(calls.at(-1)!.body.text)).toContain('устарела');

    // The right word from a private chat.
    await webhook(startMessage(555, `/start ${code}`)).expect(200);
    expect(await linkOf(u.id)).toMatchObject({ chatId: '555' });
    expect(calls.at(-1)).toMatchObject({ url: 'https://api.telegram.org/bot123456:TEST/sendMessage', body: { chat_id: '555' } });
    expect((await api(t, u.cookie, 'get', '/account/telegram').expect(200)).body).toMatchObject({ linked: true });
    // The word works once.
    await webhook(startMessage(777, `/start ${code}`)).expect(200);
    expect((await linkOf(u.id))!.chatId).toBe('555');

    // /stop from the chat unlinks.
    await webhook(startMessage(555, '/stop')).expect(200);
    expect(await linkOf(u.id)).toBeUndefined();
  });

  it('D-07 · слово живёт 15 минут', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const { url } = (await api(t, u.cookie, 'post', '/account/telegram/link').expect(200)).body as { url: string };
    const code = /start=([a-f0-9]{24})$/.exec(url)![1]!;
    await db.db.update(schema.telegramLinkCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.telegramLinkCodes.code, code));
    await webhook(startMessage(900, `/start ${code}`)).expect(200);
    expect(await linkOf(u.id)).toBeUndefined();
  });

  it('D-07 · новое прохождение приходит в Telegram: название, до трёх ответов и ссылка в кабинет; «Старт» и отвязанный чат — тишина; 403 отвязывает', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const project = (await api(t, u.cookie, 'post', '/projects').send({ title: 'Письмо Деду Морозу' }).expect(200)).body as { id: string };
    const { url } = (await api(t, u.cookie, 'post', '/account/telegram/link').expect(200)).body as { url: string };
    await webhook(startMessage(4242, `/start ${/start=(.+)$/.exec(url)![1]!}`)).expect(200);

    const notices = t.app.get(PassageNoticesService);
    const body = 'Ответы:\n• Имя: Мишаня\n• Хочет ли подарок: ДА\n• Цвет: синий\n• Ещё: четвёртый\n\nПуть: Старт → Конец';
    calls.length = 0;
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'Новое прохождение: «Письмо Деду Морозу»', body, mode: 'instant' });
    expect(calls).toHaveLength(1);
    const text = String(calls[0]!.body.text);
    expect(calls[0]!.body.chat_id).toBe('4242');
    expect(text).toContain('Новое прохождение: «Письмо Деду Морозу»');
    expect(text).toContain('• Имя: Мишаня');
    expect(text).toContain('• Цвет: синий');
    expect(text).not.toContain('четвёртый');
    expect(text).toContain(`/cabinet/projects/${project.id}?tab=responses`);
    // The cabinet still gets it.
    expect(((await api(t, u.cookie, 'get', '/notifications').expect(200)).body as Array<{ kind: string }>).some((n) => n.kind === 'passage')).toBe(true);

    // «Режим выкл» — ни кабинета, ни Telegram.
    calls.length = 0;
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'x', body, mode: 'off' });
    expect(calls).toHaveLength(0);

    // Back to «Старт»: the chat stays linked but nothing is sent.
    await db.db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, u.id));
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'Новое прохождение', body, mode: 'instant' });
    expect(calls).toHaveLength(0);
    await subscribe(u.id, 'PRO');

    // Telegram answers 403 (the person blocked the bot): the link is gone.
    nextStatus = 403;
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'Новое прохождение', body, mode: 'instant' });
    nextStatus = 200;
    expect(await linkOf(u.id)).toBeUndefined();

    // Unlink by the creator.
    await api(t, u.cookie, 'delete', '/account/telegram').expect(204);
  });

  it('D-07 · в Telegram уходят только первые три ответа, без контактов и значений', () => {
    expect(telegramAnswers('Ответы:\n• А: 1\n• Б: 2\n• В: 3\n• Г: 4\n\nСохранённые значения:\n• очки: 5')).toBe('• А: 1\n• Б: 2\n• В: 3');
    expect(telegramAnswers('Ответов на вопросы не было.')).toBe('');
  });
});
