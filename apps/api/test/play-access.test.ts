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

import { createBlock, createId, createScreen, type ProjectDocument } from '@blokum/schema';
const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const open = (t: TestApp, method: 'get' | 'post', url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set({ 'X-Blokum-CSRF': '1', ...headers });
  return body === undefined ? r : r.send(body as object);
};

describe('PL-06…PL-10 · проверки доступа и лимиты', () => {
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

  async function published(settings: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Доступ' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    if (Object.keys(settings).length > 0) await call(t, cookie, 'patch', `/projects/${created.id}/access-settings`, settings).expect(200);
    return { id: created.id, slug: created.slug };
  }
  const start = (id: string, body: Record<string, unknown> = {}) => open(t, 'post', `/play/${id}/sessions`, body, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' });
  const rows = async (id: string) => db.db.select().from(schema.participantSessions).where(eq(schema.participantSessions.projectId, id));

  it('PL-11 · старт создаёт сессию на сервере: версия, тип устройства, метка точки доступа, счётчик', async () => {
    const p = await published();
    const points = (await call(t, cookie, 'get', `/projects/${p.id}/access-points`).expect(200)).body as Array<{ id: string; code: string }>;
    const res = await start(p.id, { source: points[0]!.code }).expect(201);
    expect(res.body.sessionId).toMatch(/^[a-z0-9]{16}$/);
    const [row] = await rows(p.id);
    expect(row).toMatchObject({ status: 'IN_PROGRESS', deviceType: 'PHONE', accessPointId: points[0]!.id, isPreview: false, versionId: res.body.versionId });
    const counters = await db.db.select().from(schema.limitCounters).where(eq(schema.limitCounters.projectId, p.id));
    expect(counters).toEqual([{ projectId: p.id, kind: 'STARTS', value: 1 }]);
    await start('netakogo').expect(404);
  });

  it('PL-06 · лимит начатых: после последнего старта — «Сборка закрыта» с текстом создателя и на странице, и при старте', async () => {
    const p = await published({ maxStarts: 3, closedText: 'Места закончились' });
    for (let i = 0; i < 3; i++) await start(p.id).expect(201);
    const res = await start(p.id).expect(403);
    expect(res.body.error).toMatchObject({ code: 'CLOSED', message: 'Места закончились' });
    expect((await open(t, 'get', `/play/${p.slug}`).expect(200)).body).toMatchObject({ state: 'closed', text: 'Места закончились' });
    expect(await rows(p.id)).toHaveLength(3);
  });

  it('PL-06 · наплыв: 200 одновременных стартов при лимите 50 дают ровно 50 прохождений', async () => {
    const p = await published({ maxStarts: 50 });
    const results = await Promise.all(Array.from({ length: 200 }, () => start(p.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(50);
    expect(results.filter((r) => r.status === 403)).toHaveLength(150);
    expect(await rows(p.id)).toHaveLength(50);
    const [counter] = await db.db.select().from(schema.limitCounters).where(eq(schema.limitCounters.projectId, p.id));
    expect(counter!.value).toBe(50);
  }, 60_000);

  it('PL-06 · лимит завершённых: место держит начатое незавершённое прохождение, наплыв не превышает лимит', async () => {
    const p = await published({ maxCompletions: 20 });
    const results = await Promise.all(Array.from({ length: 60 }, () => start(p.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    // Старое незавершённое (больше суток без активности) место не держит.
    await db.db.update(schema.participantSessions).set({ lastActivityAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.participantSessions.projectId, p.id));
    await start(p.id).expect(201);
  }, 60_000);

  it('PL-07 · месячный лимит тарифа: новые прохождения не начинаются («Временно недоступно»), прошлый месяц не считается', async () => {
    const p = await published();
    const old = new Date(Date.now() - 40 * 86_400_000);
    const [version] = await db.db.select({ id: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, p.id));
    await db.db.insert(schema.participantSessions).values(Array.from({ length: 100 }, () => ({ id: createId(), projectId: p.id, versionId: version!.id!, startedAt: old, lastActivityAt: old })));
    await start(p.id).expect(201);
    await db.db.insert(schema.participantSessions).values(Array.from({ length: 99 }, () => ({ id: createId(), projectId: p.id, versionId: version!.id!, isPreview: false })));
    const res = await start(p.id).expect(503);
    expect(res.body.error).toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE', message: 'Временно недоступно' });
  }, 60_000);

  it('PL-08 · пароль: без него документа нет; неверный отклоняется; верный даёт допуск; хэш не виден создателю; смена пароля обесценивает допуск', async () => {
    const p = await published({ password: 'sekret-1' });
    const settings = (await call(t, cookie, 'get', `/projects/${p.id}/access-settings`).expect(200)).body;
    expect(settings).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(settings)).not.toMatch(/sekret|scrypt|passwordHash/);
    expect(JSON.stringify((await call(t, cookie, 'get', `/projects/${p.id}`).expect(200)).body.settings)).not.toMatch(/scrypt|passwordHash/);
    const closed = (await open(t, 'get', `/play/${p.slug}`).expect(200)).body;
    expect(closed).toMatchObject({ state: 'password' });
    expect(JSON.stringify(closed)).not.toContain('"screens"');
    await start(p.id).expect(403);
    await open(t, 'post', `/play/${p.slug}/enter`, { password: 'не тот' }).expect(403);
    const ok = (await open(t, 'post', `/play/${p.slug}/enter`, { password: 'sekret-1' }).expect(200)).body;
    expect(ok).toMatchObject({ state: 'ok' });
    expect(ok.unlock).toBeTruthy();
    expect((await open(t, 'get', `/play/${p.slug}`, undefined, { 'x-play-unlock': ok.unlock as string }).expect(200)).body.state).toBe('ok');
    await start(p.id, { unlock: ok.unlock }).expect(201);
    await call(t, cookie, 'patch', `/projects/${p.id}/access-settings`, { password: 'novyj-2' }).expect(200);
    expect((await open(t, 'get', `/play/${p.slug}`, undefined, { 'x-play-unlock': ok.unlock as string }).expect(200)).body.state).toBe('password');
    await call(t, cookie, 'patch', `/projects/${p.id}/access-settings`, { password: '' }).expect(200);
    expect((await open(t, 'get', `/play/${p.slug}`).expect(200)).body.state).toBe('ok');
  });

  it('PL-08 · перебор пароля ограничен: после десяти неверных — 429', async () => {
    const p = await published({ password: 'sekret-1' });
    for (let i = 0; i < 10; i++) await open(t, 'post', `/play/${p.slug}/enter`, { password: `bad-${i}` }).expect(403);
    const res = await open(t, 'post', `/play/${p.slug}/enter`, { password: 'sekret-1' }).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('PL-09 · «18+»: до подтверждения документа нет, старт без подтверждения отклоняется', async () => {
    const p = await published({ age18: true });
    const gate = (await open(t, 'get', `/play/${p.slug}`).expect(200)).body;
    expect(gate).toMatchObject({ state: 'age18' });
    expect(JSON.stringify(gate)).not.toContain('"screens"');
    await start(p.id).expect(403);
    expect((await open(t, 'post', `/play/${p.slug}/enter`, { age18: true }).expect(200)).body.state).toBe('ok');
    expect((await open(t, 'get', `/play/${p.slug}`, undefined, { 'x-play-age': '1' }).expect(200)).body.state).toBe('ok');
    await start(p.id, { age18: true }).expect(201);
  });

  it('PL-10 · одна попытка с устройства: токен браузера, второй старт того же — 409; другое устройство и отпечатков нет', async () => {
    const p = await published({ singleAttempt: true });
    await start(p.id).expect(400);
    await start(p.id, { deviceToken: 'ustrojstvo-1' }).expect(201);
    const again = await start(p.id, { deviceToken: 'ustrojstvo-1' }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_PLAYED');
    await start(p.id, { deviceToken: 'ustrojstvo-2' }).expect(201);
    const stored = await rows(p.id);
    expect(stored.every((r) => r.deviceTokenHash && !r.deviceTokenHash.includes('ustrojstvo'))).toBe(true);
    expect(stored.every((r) => r.ipHash === null)).toBe(true);
  });

  it('§10.3 · порядок проверок: закрыто раньше пароля, пароль раньше «18+»', async () => {
    const p = await published({ password: 'sekret-1', age18: true, maxStarts: 1 });
    expect((await open(t, 'get', `/play/${p.slug}`).expect(200)).body.state).toBe('password');
    const unlock = (await open(t, 'post', `/play/${p.slug}/enter`, { password: 'sekret-1' }).expect(200)).body.unlock as string;
    expect((await open(t, 'get', `/play/${p.slug}`, undefined, { 'x-play-unlock': unlock }).expect(200)).body.state).toBe('age18');
    await start(p.id, { unlock, age18: true }).expect(201);
    expect((await open(t, 'get', `/play/${p.slug}`).expect(200)).body.state).toBe('closed');
  });
});
