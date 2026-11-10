import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { and, eq } from 'drizzle-orm';
import { createBlock, createScreen, type Block, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { type LinkReputation, YandexSafeBrowsing } from '../src/admin/safe-browsing.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];

const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get' | 'delete', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const rich = (text: string, href?: string) => ({ paragraphs: [{ kind: 'p' as const, runs: [{ t: text, ...(href ? { href } : {}) }] }] });
const text = (value: string, href?: string): Block => createBlock('text', { textLayer: rich(value, href) });

describe('P9.1 · SR-01, TS-02…TS-05 · словари и проверка при публикации', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  const reputation: LinkReputation & { check: ReturnType<typeof vi.fn> } = { check: vi.fn(() => Promise.resolve([])) };

  async function login(role: 'USER' | 'MODERATOR' | 'ADMIN' = 'USER', ageDays = 0): Promise<{ cookie: string; id: string }> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(3000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    if (role !== 'USER') await db.db.update(schema.users).set({ role }).where(eq(schema.users.id, u!.id));
    if (ageDays > 0) await db.db.update(schema.users).set({ createdAt: new Date(Date.now() - ageDays * 86_400_000) }).where(eq(schema.users.id, u!.id));
    return { cookie, id: u!.id };
  }

  /** A project with the blocks added to the first screen, and the answer to the request to publish it. */
  async function tryPublish(cookie: string, blocks: Block[], title = 'Праздничная открытка') {
    const created = (await call(t, cookie, 'post', '/projects', { title }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(...blocks, createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    const res = await call(t, cookie, 'post', `/projects/${created.id}/publish`);
    return { id: created.id, res };
  }
  const projectRow = async (id: string) => (await db.db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0]!;
  const casesOf = async (projectId: string) => db.db.select().from(schema.reports).where(eq(schema.reports.projectId, projectId));
  const issueCodes = (res: request.Response) => ((res.body as { error: { issues?: Array<{ code: string }> } }).error.issues ?? []).map((i) => i.code);

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier, linkReputation: reputation });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('TS-02 · поле с просьбой пароля, кода из СМС или карты: публикация отклонена с объяснением, сборка остаётся черновиком; обычный текст проходит', async () => {
    const user = await login();
    const bad = await tryPublish(user.cookie, [text('Введите ваш пaроль от банка'), createBlock('textInput')]);
    expect(bad.res.status).toBe(422);
    expect(bad.res.body.error.code).toBe('PUBLISH_BLOCKED');
    expect(issueCodes(bad.res)).toContain('PHISHING_FIELD');
    expect(JSON.stringify(bad.res.body)).toContain('запрещено');
    expect((await projectRow(bad.id)).status).toBe('DRAFT');
    const ok = await tryPublish(user.cookie, [text('Как придумать надёжный пароль: пять правил')]);
    expect(ok.res.status).toBe(200);
    expect((await projectRow(ok.id)).status).toBe('PUBLISHED');
  });

  it('TS-02 · третья попытка за сутки опубликовать такое поле — флаг модерации (случай A2 в очереди), не больше одного', async () => {
    const user = await login();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await tryPublish(user.cookie, [text('Код из СМС'), createBlock('textInput')])).id);
    const flagged = (await Promise.all(ids.map(casesOf))).flat();
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ category: 'A2', priority: 'P1', status: 'NEW' });
    expect(await db.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, user.id), eq(schema.auditLog.action, 'PUBLISH_BLOCKED_PHISHING')))).toHaveLength(4);
  });

  it('TS-03 · новый аккаунт называет банк: сборка уходит на ручную проверку (снята, случай в очереди); модератор отклоняет случай — сборка снова доступна', async () => {
    const user = await login();
    const moderator = await login('MODERATOR');
    const p = await tryPublish(user.cookie, [text('Акция Сбербанка для всех')]);
    expect(p.res.status).toBe(200);
    expect(p.res.body).toMatchObject({ review: true });
    const row = await projectRow(p.id);
    expect(row.status).toBe('CLOSED');
    const cases = await casesOf(p.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ category: 'B7', priority: 'P1', status: 'NEW' });
    const notice = await db.db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(notice.some((n) => n.title.includes('ждёт проверки модератором'))).toBe(true);
    // повторная публикация тех же слов не плодит случаи
    await call(t, user.cookie, 'post', `/projects/${p.id}/publish`);
    expect(await casesOf(p.id)).toHaveLength(1);
    await call(t, moderator.cookie, 'post', `/admin/cases/${cases[0]!.id}/dismiss`, { note: 'Это акция самого автора, ничего не подделано' }).expect(204);
    expect((await projectRow(p.id)).status).toBe('PUBLISHED');
  });

  it('TS-03 · аккаунт старше 30 дней: сборка с банком публикуется сразу, автору — предупреждение, случая нет', async () => {
    const user = await login('USER', 45);
    const p = await tryPublish(user.cookie, [text('Тариф МТС и Госуслуги')]);
    expect(p.res.status).toBe(200);
    expect((p.res.body as { review: boolean; warnings: string[] }).review).toBe(false);
    expect((p.res.body as { warnings: string[] }).warnings.length).toBeGreaterThan(0);
    expect((await projectRow(p.id)).status).toBe('PUBLISHED');
    expect(await casesOf(p.id)).toEqual([]);
  });

  it('TS-04 · стоп-слова: словарь из базы; высший вес блокирует; средний — случай в очереди без снятия; выключенное и удалённое не действуют; правит только администратор, всё в журнале', async () => {
    const user = await login('USER', 60);
    const admin = await login('ADMIN');
    const plain = await login();
    expect((await call(t, admin.cookie, 'get', '/admin/safety-terms').expect(200)).body.terms.length).toBeGreaterThan(10);
    await call(t, plain.cookie, 'get', '/admin/safety-terms').expect(403);
    await call(t, plain.cookie, 'post', '/admin/safety-terms', { kind: 'STOP', term: 'абвгд', category: 'B', weight: 90 }).expect(403);
    // из основного набора
    const blocked = await tryPublish(user.cookie, [text('Где купить кокаин недорого')]);
    expect(blocked.res.status).toBe(422);
    expect(issueCodes(blocked.res)).toContain('STOP_WORD_BLOCK');
    // свой термин с весом 90 блокирует, с весом 40 — только случай
    for (const bad of [{ kind: 'STOP', term: 'x', category: 'B', weight: 90 }, { kind: 'STOP', term: 'абвгд', weight: 90 }, { kind: 'STOP', term: 'абвгд', category: 'B', weight: 101 }, { kind: 'DOMAIN', term: 'без-точки' }, { kind: 'FOO', term: 'абвгд' }]) {
      await call(t, admin.cookie, 'post', '/admin/safety-terms', bad).expect(422);
    }
    const added = (await call(t, admin.cookie, 'post', '/admin/safety-terms', { kind: 'STOP', term: 'ЗЕЛЁН ЕДИНОРОГ', category: 'B', weight: 90, note: 'проверка' }).expect(201)).body as { id: string; term: string };
    expect(added.term).toBe('зелён единорог');
    await call(t, admin.cookie, 'post', '/admin/safety-terms', { kind: 'STOP', term: 'зелён единорог', category: 'B' }).expect(409);
    const heavy = await tryPublish(user.cookie, [text('Продаю зелёных единорогов')]);
    expect(heavy.res.status).toBe(422);
    await call(t, admin.cookie, 'patch', `/admin/safety-terms/${added.id}`, { weight: 40 }).expect(200);
    const light = await tryPublish(user.cookie, [text('Продаю зелёных единорогов')]);
    expect(light.res.status).toBe(200);
    expect((await projectRow(light.id)).status).toBe('PUBLISHED'); // старый аккаунт: не снимается, но случай есть
    const lightCases = await casesOf(light.id);
    expect(lightCases).toHaveLength(1);
    expect(lightCases[0]).toMatchObject({ category: 'B', priority: 'P1' });
    await call(t, admin.cookie, 'patch', `/admin/safety-terms/${added.id}`, { active: false }).expect(200);
    const off = await tryPublish(user.cookie, [text('Продаю зелёных единорогов')]);
    expect(await casesOf(off.id)).toEqual([]);
    await call(t, admin.cookie, 'delete', `/admin/safety-terms/${added.id}`).expect(204);
    await call(t, admin.cookie, 'delete', `/admin/safety-terms/${added.id}`).expect(404);
    const log = await db.db.select({ action: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.targetId, added.id));
    expect(log.map((l) => l.action).sort()).toEqual(['SAFETY_TERM_CHANGED', 'SAFETY_TERM_CHANGED', 'SAFETY_TERM_CREATED', 'SAFETY_TERM_DELETED']);
  });

  it('TS-04 · с пустым словарём публикация работает (продукт не зависит от наполнения)', async () => {
    const user = await login('USER', 60);
    const admin = await login('ADMIN');
    const all = (await call(t, admin.cookie, 'get', '/admin/safety-terms').expect(200)).body.terms as Array<{ id: string }>;
    const saved = await db.db.select().from(schema.safetyTerms);
    for (const term of all) await call(t, admin.cookie, 'delete', `/admin/safety-terms/${term.id}`).expect(204);
    const p = await tryPublish(user.cookie, [text('Где купить кокаин недорого')]);
    expect(p.res.status).toBe(200);
    await db.db.insert(schema.safetyTerms).values(saved);
  });

  it('TS-05 · ссылки: сокращатель, IP-адрес и сайт из стоп-листа администратора — отказ; обычный сайт, почта и телефон проходят', async () => {
    const user = await login('USER', 60);
    const admin = await login('ADMIN');
    const short = await tryPublish(user.cookie, [text('Нажмите здесь', 'https://bit.ly/abc')]);
    expect(short.res.status).toBe(422);
    expect(issueCodes(short.res)).toContain('LINK_SHORTENER');
    expect(issueCodes(await tryPublish(user.cookie, [text('Перейти', 'http://185.12.4.5/login')]).then((r) => r.res))).toContain('LINK_IP');
    expect((await tryPublish(user.cookie, [text('Напишите нам', 'mailto:hello@example.org'), text('Позвоните', 'tel:+79001234567'), text('Сайт', 'https://example.org/page')])).res.status).toBe(200);
    await call(t, admin.cookie, 'post', '/admin/safety-terms', { kind: 'DOMAIN', term: 'https://www.Plohoi-Sait.example/x' }).expect(201);
    const listed = (await call(t, admin.cookie, 'get', '/admin/safety-terms').expect(200)).body.terms as Array<{ kind: string; term: string }>;
    expect(listed).toContainEqual(expect.objectContaining({ kind: 'DOMAIN', term: 'plohoi-sait.example' }));
    const blocked = await tryPublish(user.cookie, [text('Туда', 'https://sub.plohoi-sait.example/a')]);
    expect(issueCodes(blocked.res)).toContain('LINK_BLOCKED');
  });

  it('TS-05 · Яндекс Safe Browsing: опасная ссылка — отказ; сервис не ответил — публикация идёт; адреса уходят только у веб-ссылок', async () => {
    const user = await login('USER', 60);
    reputation.check.mockResolvedValueOnce([{ url: 'https://phish.example/in', threat: 'SOCIAL_ENGINEERING' }]);
    const bad = await tryPublish(user.cookie, [text('Вход', 'https://phish.example/in')]);
    expect(bad.res.status).toBe(422);
    expect(JSON.stringify(bad.res.body)).toContain('Яндекс считает эту ссылку опасной');
    expect(reputation.check).toHaveBeenLastCalledWith(['https://phish.example/in']);
    reputation.check.mockRejectedValueOnce(new Error('сеть недоступна'));
    expect((await tryPublish(user.cookie, [text('Сайт', 'https://example.org/ok'), text('Почта', 'mailto:a@b.ru')])).res.status).toBe(200);
    expect(reputation.check).toHaveBeenLastCalledWith(['https://example.org/ok']);
  });

  it('TS-05 · клиент Яндекс Safe Browsing: запрос в формате Lookup API v4, пустой ответ — безопасно, совпадения возвращаются, ошибка — исключение', async () => {
    const calls: Array<{ url: string; body: { threatInfo: { threatEntries: Array<{ url: string }>; threatEntryTypes: string[] }; client: { clientId: string } } }> = [];
    const answer: { text: string; status: number } = { text: '', status: 200 };
    const impl = vi.fn((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(init!.body as string) as (typeof calls)[number]['body'] });
      return Promise.resolve(new Response(answer.text, { status: answer.status }));
    }) as unknown as typeof fetch;
    const client = new YandexSafeBrowsing('KEY 1', impl, 'https://sba.test/v4/threatMatches:find');
    expect(await client.check(['https://a.example/'])).toEqual([]);
    expect(calls[0]!.url).toBe('https://sba.test/v4/threatMatches:find?key=KEY%201');
    expect(calls[0]!.body.threatInfo).toMatchObject({ threatEntryTypes: ['URL'], threatEntries: [{ url: 'https://a.example/' }] });
    answer.text = JSON.stringify({ matches: [{ threatType: 'MALWARE', platformType: 'ANY_PLATFORM', threatEntryType: 'URL', threat: { url: 'https://a.example/' }, cacheDuration: '300.00s' }] });
    expect(await client.check(['https://a.example/'])).toEqual([{ url: 'https://a.example/', threat: 'MALWARE' }]);
    expect(await client.check([])).toEqual([]);
    expect(calls).toHaveLength(2); // пустой список никуда не отправляется
    answer.status = 503;
    await expect(client.check(['https://a.example/'])).rejects.toThrow('503');
  });
});
