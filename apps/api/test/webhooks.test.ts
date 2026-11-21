import { createServer, type IncomingMessage, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { createBlock, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { MAX_ATTEMPTS, RETRY_PAUSES_MS, WebhooksService, signWebhook } from '../src/webhooks/webhooks.service.js';
import { WebhookAddressError, isPublicAddress, parseWebhookUrl, resolvePublic } from '../src/webhooks/net.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('D-07 · вебхук сборки на «Про»: подпись HMAC, повторы, защита адреса (ADR-129)', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let strict: TestApp;
  let db: TestDb;
  let receiver: Server;
  let hookUrl = '';
  /** What the creator's server answers next. */
  let answerStatus = 200;
  const received: Received[] = [];
  const sentCodes: { phone: string; code: string }[] = [];
  let phoneCounter = 0;

  const login = async (app: TestApp): Promise<{ cookie: string; id: string }> => {
    await db.db.delete(schema.otpRequests);
    const phone = `+7901${String(3000000 + ++phoneCounter).slice(-7)}`;
    await request(app.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(app.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const me = (await request(app.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200)).body as { id: string };
    return { cookie, id: me.id };
  };
  const api = (app: TestApp, cookie: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown) => {
    const r = request(app.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  const open = (url: string, body: unknown = {}) => request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').send(body as object);
  const subscribe = (userId: string, planCode: string) =>
    db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });

  /** A published project: a text question and a button. */
  const publish = async (cookie: string, title = 'Заявка'): Promise<{ id: string; slug: string; textId: string }> => {
    const created = (await api(t, cookie, 'post', '/projects', { title }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const text = createBlock('textInput');
    text.name = 'Ваш город';
    doc.screens[0]!.blocks.push(text, createBlock('button'));
    await api(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await api(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, slug: created.slug, textId: text.id };
  };
  const pass = async (p: { id: string; textId: string }, city: string): Promise<string> => {
    const sid = ((await open(`/play/${p.id}/sessions`).expect(201)).body as { sessionId: string }).sessionId;
    await open(`/play/sessions/${sid}/answers`, { blockId: p.textId, value: { kind: 'text', value: city }, clientEventId: `e${Math.random().toString(36).slice(2, 12)}`, clientTs: Date.now() }).expect(200);
    await open(`/play/sessions/${sid}/complete`).expect(200);
    return sid;
  };
  const deliveriesOf = (projectId: string) => db.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.projectId, projectId));
  const waitFor = async (check: () => Promise<boolean> | boolean, what: string): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Не дождались: ${what}`);
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      receiver = createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          received.push({ headers: req.headers, body });
          res.writeHead(answerStatus).end('ok');
        });
      });
      await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
      const addr = receiver.address();
      hookUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/hook`;
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { phoneLogin: true, webhookAllowPrivate: true });
      strict = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { phoneLogin: true, webhookAllowPrivate: false });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await strict?.app.close();
    await new Promise((r) => receiver?.close(r));
    await db?.drop();
  });

  it('D-07 · вебхук только на «Про»: «Старт» и «Плюс» видят замок и получают 402, чужой человек — 404', async () => {
    const u = await login(t);
    const p = await publish(u.cookie);
    expect((await api(t, u.cookie, 'get', `/projects/${p.id}/webhook`).expect(200)).body).toMatchObject({ allowed: false, planTitle: 'Старт', webhook: null, deliveries: [] });
    const refused = await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl }).expect(402);
    expect(refused.body.error.message).toBe('Вебхук недоступен на тарифе «Старт». Он есть на тарифе «Про».');
    await subscribe(u.id, 'PLUS');
    await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl }).expect(402);
    const other = await login(t);
    await api(t, other.cookie, 'get', `/projects/${p.id}/webhook`).expect(404);
  });

  it('D-07 · завершённое прохождение уходит на адрес создателя: JSON с ответами, подпись HMAC-SHA256 по секрету сборки сходится', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const p = await publish(u.cookie, 'Запись на мастер-класс');
    const saved = (await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl }).expect(200)).body as { allowed: boolean; webhook: { url: string; secret: string; enabled: boolean } };
    expect(saved.allowed).toBe(true);
    expect(saved.webhook).toMatchObject({ url: hookUrl, enabled: true });
    expect(saved.webhook.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    // The secret is not kept as it is: only encrypted.
    const [row] = await db.db.select().from(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, p.id));
    expect(row!.secretEnc).not.toContain(saved.webhook.secret);

    received.length = 0;
    const sid = await pass(p, 'Казань');
    await waitFor(() => received.length === 1, 'запрос вебхука');
    const got = received[0]!;
    expect(got.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(got.headers['x-blokker-event']).toBe('passage.completed');
    const ts = String(got.headers['x-blokker-timestamp']);
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(30);
    expect(got.headers['x-blokker-signature']).toBe(`sha256=${signWebhook(saved.webhook.secret, ts, got.body)}`);
    expect(got.headers['x-blokker-signature']).not.toBe(`sha256=${signWebhook('whsec_other', ts, got.body)}`);
    const payload = JSON.parse(got.body) as { event: string; deliveryId: string; project: { id: string; title: string; link: string }; passage: { id: string; answers: Array<{ question: string; text: string; blockId: string }>; completedAt: string } };
    expect(payload.event).toBe('passage.completed');
    expect(got.headers['x-blokker-delivery']).toBe(payload.deliveryId);
    expect(payload.project).toEqual({ id: p.id, title: 'Запись на мастер-класс', link: `http://localhost:3110/s/${p.slug}` });
    expect(payload.passage.id).toBe(sid);
    expect(payload.passage.completedAt).toEqual(expect.any(String));
    expect(payload.passage.answers).toEqual([expect.objectContaining({ blockId: p.textId, question: 'Ваш город', text: 'Казань' })]);
    await waitFor(async () => (await deliveriesOf(p.id))[0]?.status === 'DELIVERED', 'отметка о доставке');
    const view = (await api(t, u.cookie, 'get', `/projects/${p.id}/webhook`).expect(200)).body as { deliveries: Array<{ status: string; attempts: number; lastResult: string; event: string }> };
    expect(view.deliveries).toEqual([expect.objectContaining({ event: 'passage.completed', status: 'DELIVERED', attempts: 1, lastResult: 'ответ 200' })]);
  });

  it('D-07 · сбой у создателя: повторы через 1, 5, 30 мин, 2 и 6 ч; после 6 попыток — «не доставлено» и одно сообщение в кабинете; «Отправить ещё раз» доставляет', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const p = await publish(u.cookie, 'Опрос гостей');
    await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl }).expect(200);
    answerStatus = 500;
    received.length = 0;
    await pass(p, 'Тверь');
    await waitFor(async () => (await deliveriesOf(p.id))[0]?.lastResult === 'ответ 500', 'первая попытка');
    const service = t.app.get(WebhooksService);
    let [d] = await deliveriesOf(p.id);
    expect(d).toMatchObject({ status: 'PENDING', attempts: 1 });
    // Too early: the pause has not passed, nothing is sent.
    expect(await service.flush(new Date(d!.lastAttemptAt!.getTime() + RETRY_PAUSES_MS[0] - 1000))).toBe(0);
    expect(received).toHaveLength(1);
    let clock = d!.lastAttemptAt!.getTime();
    for (let i = 0; i < RETRY_PAUSES_MS.length; i++) {
      clock += RETRY_PAUSES_MS[i]! + 1000;
      await service.flush(new Date(clock));
      [d] = await deliveriesOf(p.id);
      expect(d!.attempts).toBe(i + 2);
    }
    expect(received).toHaveLength(MAX_ATTEMPTS);
    expect(d).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, lastResult: 'ответ 500' });
    await service.flush(new Date(clock + 86_400_000));
    expect(received).toHaveLength(MAX_ATTEMPTS);
    const notes = await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, u.id), eq(schema.notifications.kind, 'webhook-failed')));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe('Вебхук сборки «Опрос гостей» не принимает данные');
    expect(notes[0]!.body).toContain('Последний результат: ответ 500');

    // A second failure on the same day: no second message.
    await db.db.update(schema.webhookDeliveries).set({ status: 'PENDING', attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) }).where(eq(schema.webhookDeliveries.id, d!.id));
    await service.flush(new Date());
    expect(await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, u.id), eq(schema.notifications.kind, 'webhook-failed')))).toHaveLength(1);

    answerStatus = 200;
    const again = (await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/deliveries/${d!.id}/retry`).expect(200)).body as { status: string; attempts: number };
    expect(again).toMatchObject({ status: 'DELIVERED', attempts: 1 });
    await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/deliveries/${d!.id}/retry`).expect(404);
  });

  it('D-07 · «Отправить проверку» — одна попытка без повторов; новый секрет меняет подпись; выключенный и удалённый вебхук ничего не шлёт', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const p = await publish(u.cookie, 'Проверка');
    await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/test`).expect(404);
    const first = (await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl }).expect(200)).body as { webhook: { secret: string } };
    received.length = 0;
    answerStatus = 200;
    expect((await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/test`).expect(200)).body).toMatchObject({ event: 'ping', status: 'DELIVERED', lastResult: 'ответ 200' });
    expect(JSON.parse(received[0]!.body)).toMatchObject({ event: 'ping', project: { id: p.id, title: 'Проверка' } });
    answerStatus = 503;
    expect((await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/test`).expect(200)).body).toMatchObject({ status: 'FAILED', attempts: 1, lastResult: 'ответ 503' });
    expect(await db.db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, u.id), eq(schema.notifications.kind, 'webhook-failed')))).toHaveLength(0);
    answerStatus = 200;

    const rotated = (await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/secret`).expect(200)).body as { webhook: { secret: string } };
    expect(rotated.webhook.secret).not.toBe(first.webhook.secret);
    received.length = 0;
    await api(t, u.cookie, 'post', `/projects/${p.id}/webhook/test`).expect(200);
    const ts = String(received[0]!.headers['x-blokker-timestamp']);
    expect(received[0]!.headers['x-blokker-signature']).toBe(`sha256=${signWebhook(rotated.webhook.secret, ts, received[0]!.body)}`);

    await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl, enabled: false }).expect(200);
    received.length = 0;
    await pass(p, 'Омск');
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(0);
    expect((await deliveriesOf(p.id)).filter((d) => d.event === 'passage.completed')).toHaveLength(0);
    await api(t, u.cookie, 'delete', `/projects/${p.id}/webhook`).expect(204);
    expect((await api(t, u.cookie, 'get', `/projects/${p.id}/webhook`).expect(200)).body).toMatchObject({ webhook: null });
  });

  it('D-07 · тариф понизили: ожидающая отправка не уходит и помечается, новые прохождения не отправляются', async () => {
    const u = await login(t);
    await subscribe(u.id, 'PRO');
    const p = await publish(u.cookie, 'Понижение');
    await api(t, u.cookie, 'put', `/projects/${p.id}/webhook`, { url: hookUrl }).expect(200);
    answerStatus = 500;
    await pass(p, 'Сочи');
    await waitFor(async () => (await deliveriesOf(p.id))[0]?.lastResult === 'ответ 500', 'первая попытка');
    await db.db.update(schema.subscriptions).set({ status: 'EXPIRED', currentPeriodEnd: new Date(Date.now() - 1000) }).where(eq(schema.subscriptions.userId, u.id));
    answerStatus = 200;
    received.length = 0;
    await t.app.get(WebhooksService).flush(new Date(Date.now() + RETRY_PAUSES_MS[0] + 5000));
    expect(received).toHaveLength(0);
    expect((await deliveriesOf(p.id))[0]).toMatchObject({ status: 'FAILED', lastResult: 'вебхук недоступен на тарифе' });
    await pass(p, 'Ялта');
    expect(await deliveriesOf(p.id)).toHaveLength(1);
  });

  it('D-07 · адрес проверяется: только https, без логина в адресе, не внутренняя сеть (127.0.0.1, localhost, 10.x, 169.254.x); ошибки по-русски', async () => {
    const u = await login(strict);
    await subscribe(u.id, 'PRO');
    const created = (await api(strict, u.cookie, 'post', '/projects', { title: 'Строгий' }).expect(200)).body as { id: string };
    const refuse = async (url: unknown, message: string) => {
      const res = await api(strict, u.cookie, 'put', `/projects/${created.id}/webhook`, { url }).expect(422);
      expect(res.body.error, String(url)).toEqual({ code: 'INVALID_WEBHOOK_URL', message });
    };
    await refuse('', 'Укажите адрес, на который отправлять данные.');
    await refuse('не адрес', 'Это не похоже на адрес сайта. Пример: https://example.ru/blokker');
    await refuse(hookUrl, 'Адрес должен начинаться с https:// — данные участников передаются только по защищённому соединению.');
    await refuse('https://user:pass@example.ru/hook', 'Логин и пароль в адресе не допускаются. Проверяйте подпись запроса.');
    for (const url of ['https://127.0.0.1/hook', 'https://10.1.2.3/hook', 'https://169.254.169.254/latest', 'https://[::1]/hook', 'https://localhost/hook']) {
      await refuse(url, 'Адрес ведёт во внутреннюю сеть. Укажите сервер, доступный из интернета.');
    }
    await refuse(`https://${'a'.repeat(500)}.ru/`, 'Адрес длиннее 500 символов.');
    expect(await db.db.select().from(schema.projectWebhooks).where(eq(schema.projectWebhooks.projectId, created.id))).toHaveLength(0);
  });

  it('D-07 · isPublicAddress и resolvePublic: частные, служебные и отображённые в IPv6 адреса закрыты, имя с хотя бы одним внутренним адресом — тоже', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '2001:db8::1', 'не-адрес']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['77.88.55.88', '195.209.215.79', '172.32.0.1', '2a02:6b8::2:242', '::ffff:77.88.55.88']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
    const resolver = (host: string) => Promise.resolve(host === 'mixed.example' ? [{ address: '77.88.55.88', family: 4 }, { address: '10.0.0.1', family: 4 }] : [{ address: '77.88.55.88', family: 4 }]);
    await expect(resolvePublic('mixed.example', false, resolver)).rejects.toBeInstanceOf(WebhookAddressError);
    await expect(resolvePublic('ok.example', false, resolver)).resolves.toEqual({ address: '77.88.55.88', family: 4 });
    await expect(resolvePublic('missing.example', false, () => Promise.reject(new Error('ENOTFOUND')))).rejects.toThrow('Не удалось найти такой сервер. Проверьте адрес.');
    expect(parseWebhookUrl(' https://example.ru/hook#frag ', false).toString()).toBe('https://example.ru/hook');
    expect(() => parseWebhookUrl('ftp://example.ru/', false)).toThrow(WebhookAddressError);
  });
});
