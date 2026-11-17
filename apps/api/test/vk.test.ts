import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { PassageNoticesService, messengerText } from '../src/play/passage-notices.service.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const SECRET = 'callback-secret-for-tests';
const GROUP = { token: 'vk1.a.TEST', groupId: 230000001, screenName: 'blokker', secret: SECRET, confirmation: 'a1b2c3d4' };
let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];

describe('D-07 · сообщество ВКонтакте: привязка диалога, Callback API, сообщения о прохождениях (ADR-110)', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let off: TestApp;
  let db: TestDb;
  const calls: Array<{ url: string; params: Record<string, string> }> = [];
  /** The next answer of VK API: a code of an error or a normal answer. */
  let nextError: number | null = null;

  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, params: Object.fromEntries(new URLSearchParams(init.body)) });
    const body = nextError === null ? { response: 1 } : { error: { error_code: nextError, error_msg: 'ошибка' } };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };

  const login = async (app: TestApp): Promise<{ cookie: string; id: string }> => {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(5000000 + ++phoneCounter).slice(-7)}`;
    await request(app.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(app.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const me = (await request(app.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200)).body as { id: string };
    return { cookie, id: me.id };
  };
  const api = (app: TestApp, cookie: string, method: 'get' | 'post' | 'delete', url: string) => request(app.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  const callback = async (body: unknown, app: TestApp = t): Promise<string> => (await request(app.http()).post(`/${API_PREFIX}/vk/callback`).send(body as object).expect(200)).text;
  const subscribe = (userId: string, planCode: string) =>
    db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });
  /** `message_new` as Callback API sends it: the message object with `from_id`, `peer_id`, `text` and, from a `vk.me?ref=` link, `ref`. */
  const message = (from: number, text: string, extra: Record<string, unknown> = {}, secret: string | null = SECRET) => ({
    type: 'message_new',
    group_id: GROUP.groupId,
    event_id: `e${Math.random()}`,
    v: '5.199',
    ...(secret === null ? {} : { secret }),
    object: { message: { id: 1, date: 1, from_id: from, peer_id: from, text, ...extra }, client_info: {} },
  });
  const linkOf = async (userId: string) => (await db.db.select().from(schema.vkLinks).where(eq(schema.vkLinks.userId, userId)))[0];
  const startCode = async (cookie: string): Promise<{ url: string; code: string }> => (await api(t, cookie, 'post', '/account/vk/link').expect(200)).body as { url: string; code: string };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier, vkFetch: fetchFn }, { phoneLogin: true, vk: GROUP });
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

  it('D-07 · сообщество не подключено: «Настройки» это показывают, привязать нельзя, Callback API отвечает «ok»', async () => {
    const u = await login(off);
    expect((await api(off, u.cookie, 'get', '/account/vk').expect(200)).body).toMatchObject({ configured: false, linked: false });
    const res = await api(off, u.cookie, 'post', '/account/vk/link').expect(503);
    expect(res.body.error.message).toBe('Сообщения во ВКонтакте ещё не подключены.');
    expect(await callback({ type: 'confirmation', group_id: GROUP.groupId }, off)).toBe('ok');
  });

  it('D-07 · подтверждение адреса: строка из настроек только для своего сообщества', async () => {
    expect(await callback({ type: 'confirmation', group_id: GROUP.groupId })).toBe('a1b2c3d4');
    expect(await callback({ type: 'confirmation', group_id: 999 })).toBe('ok');
  });

  it('D-07 · на «Старте» привязать нельзя; на любом платном тарифе — можно («Автор», «Плюс», «Про»)', async () => {
    const u = await login(t);
    expect((await api(t, u.cookie, 'get', '/account/vk').expect(200)).body).toMatchObject({ configured: true, allowed: false });
    const refused = await api(t, u.cookie, 'post', '/account/vk/link').expect(402);
    expect(refused.body.error.message).toBe('Сообщения во ВКонтакте есть на платных тарифах.');
    for (const plan of ['AUTHOR', 'PLUS', 'PRO']) {
      const p = await login(t);
      await subscribe(p.id, plan);
      expect((await api(t, p.cookie, 'get', '/account/vk').expect(200)).body, plan).toMatchObject({ allowed: true });
      await api(t, p.cookie, 'post', '/account/vk/link').expect(200);
    }
    // «Праздник»: a pass for one project of the person — counts while it is valid.
    const pass = await login(t);
    const project = (await api(t, pass.cookie, 'post', '/projects').send({ title: 'Открытка' }).expect(200)).body as { id: string };
    await db.db.insert(schema.entitlements).values({ userId: pass.id, projectId: project.id, feature: 'PASS', validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 30 * 86_400_000) });
    expect((await api(t, pass.cookie, 'get', '/account/vk').expect(200)).body).toMatchObject({ allowed: true });
  });

  it('D-07 · «Про»: ссылка vk.me с одноразовым словом привязывает диалог; без секрета, чужое слово и беседа не привязывают; «стоп» отвязывает', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const { url, code } = await startCode(u.cookie);
    expect(url).toBe(`https://vk.me/blokker?ref=${code}`);
    expect(code).toMatch(/^[a-f0-9]{24}$/);

    // Not VK (no secret, wrong secret): nothing happens, the answer is still «ok».
    calls.length = 0;
    expect(await callback(message(555, 'Начать', { ref: code }, null))).toBe('ok');
    expect(await callback(message(555, 'Начать', { ref: code }, 'wrong'))).toBe('ok');
    expect(await linkOf(u.id)).toBeUndefined();
    expect(calls).toHaveLength(0);
    // A group conversation does not link.
    await callback({ ...message(555, 'Начать', { ref: code }), object: { message: { from_id: 555, peer_id: 2000000001, text: 'Начать', ref: code } } });
    expect(await linkOf(u.id)).toBeUndefined();
    // An unknown word gets a hint, not a link.
    await callback(message(555, 'Начать', { ref: '0'.repeat(24) }));
    expect(await linkOf(u.id)).toBeUndefined();
    expect(calls.at(-1)!.params.message).toContain('устарела');

    // The right word in `ref`.
    calls.length = 0;
    expect(await callback(message(555, 'Начать', { ref: code }))).toBe('ok');
    expect(await linkOf(u.id)).toMatchObject({ peerId: '555' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.vk.com/method/messages.send');
    expect(calls[0]!.params).toMatchObject({ peer_id: '555', access_token: 'vk1.a.TEST', v: '5.199', dont_parse_links: '1' });
    expect(Number(calls[0]!.params.random_id)).toBeGreaterThan(0);
    expect((await api(t, u.cookie, 'get', '/account/vk').expect(200)).body).toMatchObject({ linked: true });
    // The word works once.
    await callback(message(777, 'Начать', { ref: code }));
    expect((await linkOf(u.id))!.peerId).toBe('555');

    // «стоп» from the dialog unlinks.
    await callback(message(555, 'Стоп'));
    expect(await linkOf(u.id)).toBeUndefined();
  });

  it('D-07 · слово можно прислать текстом (если диалог открыт без ссылки); оно живёт 15 минут', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const { code } = await startCode(u.cookie);
    await callback(message(601, `мой код ${code.toUpperCase()}`));
    expect(await linkOf(u.id)).toMatchObject({ peerId: '601' });

    const v = await login(t);
    await subscribe(v.id, 'PRO');
    const late = (await startCode(v.cookie)).code;
    await db.db.update(schema.vkLinkCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.vkLinkCodes.code, late));
    await callback(message(602, late));
    expect(await linkOf(v.id)).toBeUndefined();
  });

  it('D-07 · новое прохождение приходит во ВКонтакте коротко: название сборки, сколько всего и ссылка — без ответов участников; «Старт» — тишина; запрет сообщений отвязывает', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const project = (await api(t, u.cookie, 'post', '/projects').send({ title: 'Письмо Деду Морозу' }).expect(200)).body as { id: string };
    await callback(message(4242, 'Начать', { ref: (await startCode(u.cookie)).code }));

    const notices = t.app.get(PassageNoticesService);
    const body = 'Ответы:\n• Имя: Мишаня\n• Хочет ли подарок: ДА\n• Цвет: синий\n\nПуть: Старт → Конец';
    calls.length = 0;
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'Новое прохождение: «Письмо Деду Морозу»', body, mode: 'instant' });
    expect(calls).toHaveLength(1);
    const text = calls[0]!.params.message!;
    expect(calls[0]!.params.peer_id).toBe('4242');
    expect(text).toBe(`Новое прохождение сборки «Письмо Деду Морозу».\nВсего прохождений: 0.\n\nОткрыть в кабинете: http://localhost:3110/cabinet/projects/${project.id}?tab=responses`);
    for (const secret of ['Мишаня', 'синий', 'ДА', 'Путь', '•']) expect(text).not.toContain(secret);
    expect(((await api(t, u.cookie, 'get', '/notifications').expect(200)).body as Array<{ kind: string }>).some((n) => n.kind === 'passage')).toBe(true);

    // «выкл» — nothing.
    calls.length = 0;
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'x', body, mode: 'off' });
    expect(calls).toHaveLength(0);

    // Back to «Старт»: the dialog stays linked but nothing is sent.
    await db.db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, u.id));
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'x', body, mode: 'instant' });
    expect(calls).toHaveLength(0);
    await subscribe(u.id, 'PRO');

    // VK: 901 — the person no longer allows messages from the community: the link is gone.
    nextError = 901;
    await notices.deliver({ ownerId: u.id, projectId: project.id, title: 'x', body, mode: 'instant' });
    nextError = null;
    expect(await linkOf(u.id)).toBeUndefined();

    // `message_deny` from VK also unlinks; the creator can unlink in «Настройки».
    await callback(message(4243, 'Начать', { ref: (await startCode(u.cookie)).code }));
    expect(await linkOf(u.id)).toBeDefined();
    await callback({ type: 'message_deny', group_id: GROUP.groupId, secret: SECRET, object: { user_id: 4243 } });
    expect(await linkOf(u.id)).toBeUndefined();
    await api(t, u.cookie, 'delete', '/account/vk').expect(204);
  });

  it('D-07 · текст сообщения: одно прохождение и сводка за период, длинное название обрезается', () => {
    const link = 'https://blokker.ru/cabinet/projects/p1?tab=responses';
    expect(messengerText({ projectTitle: 'Квиз', span: null, count: 1, total: 12, link })).toBe(`Новое прохождение сборки «Квиз».\nВсего прохождений: 12.\n\nОткрыть в кабинете: ${link}`);
    expect(messengerText({ projectTitle: 'Квиз', span: 'за час', count: 3, total: 15, link })).toBe(`Новые прохождения сборки «Квиз»: 3 за час.\nВсего прохождений: 15.\n\nОткрыть в кабинете: ${link}`);
    expect(messengerText({ projectTitle: 'я'.repeat(200), span: null, count: 1, total: 1, link })).toContain(`«${'я'.repeat(79)}…»`);
  });
});
