import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Reflector, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { createBlock, createScreen, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../src/auth/decorators.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/*
 * P9.4 · N-04 · docs/02-ARCHITECTURE.md §8 п. 10: «проверка роли на каждом эндпоинте» и тесты IDOR по эндпоинтам кабинета.
 * Список маршрутов берётся из метаданных Nest: новый эндпоинт, которого нет в таблицах ниже, ломает тест.
 */
const METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;
type Method = (typeof METHODS)[number];

/** Not public, no role: any signed-in user, and what they get depends only on their own session — nothing to take from another person by an id. */
const OWN_SESSION = new Set([
  'POST /auth/onboarding/consent', 'GET /auth/onboarding', 'GET /auth/account', 'PATCH /auth/account', 'POST /auth/account/email', 'GET /auth/account/sessions',
  'GET /auth/account/consents', 'DELETE /auth/account/consents/marketing', 'POST /auth/account/export', 'DELETE /auth/account', 'POST /auth/account/restore',
  'POST /auth/account/totp/setup', 'POST /auth/account/totp/confirm', 'DELETE /auth/account/totp',
  'GET /auth/me', 'GET /auth/sessions', 'DELETE /auth/sessions',
  'GET /notifications', 'GET /media', 'POST /media', 'POST /media/sessions', 'GET /projects', 'POST /projects', 'GET /themes', 'POST /themes', 'POST /themes/from-image',
]);

/** Not public, no role, and the route names an object by an id: another signed-in user must get neither it nor a change of it (IDOR). */
const BY_ID = new Set([
  'DELETE /auth/sessions/:id',
  'POST /notifications/:id/read',
  'PUT /media/sessions/:id', 'POST /media/sessions/:id/complete', 'GET /media/:id/file', 'DELETE /media/:id',
  'GET /projects/:id/moderation', 'POST /projects/:id/appeals',
  'GET /projects/:id', 'PATCH /projects/:id', 'DELETE /projects/:id', 'POST /projects/:id/restore', 'POST /projects/:id/duplicate', 'POST /projects/:id/status', 'POST /projects/:id/publish',
  'GET /projects/:id/access-settings', 'PATCH /projects/:id/access-settings', 'GET /projects/:id/advertising', 'PATCH /projects/:id/advertising',
  'GET /projects/:id/operator-info', 'PATCH /projects/:id/operator-info', 'POST /projects/:id/dpa-accept',
  'PUT /projects/:id/draft', 'GET /projects/:id/versions', 'GET /projects/:id/versions/:versionId', 'POST /projects/:id/restore/:versionId',
  'GET /projects/:projectId/responses', 'GET /projects/:projectId/responses/export.csv', 'GET /projects/:projectId/responses/export.xlsx',
  'GET /projects/:projectId/responses/:id', 'DELETE /projects/:projectId/responses/:id', 'POST /projects/:projectId/responses/:id/viewed',
  'GET /projects/:projectId/access-points', 'POST /projects/:projectId/access-points', 'POST /projects/:projectId/access-points/:id/active',
  'DELETE /projects/:projectId/access-points/:id', 'GET /projects/:projectId/access-points/:id/qr.png', 'GET /projects/:projectId/access-points/:id/qr.svg',
  'POST /themes/from-project/:projectId', 'GET /themes/:id', 'PUT /themes/:id', 'DELETE /themes/:id', 'POST /themes/:id/duplicate', 'POST /themes/:id/default',
]);

interface Route {
  key: string;
  method: Method;
  path: string;
  isPublic: boolean;
  roles: string[];
}

let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];

describe('P9.4 · N-04 · роли и доступ к чужим объектам на каждом эндпоинте', { timeout: 120_000 }, () => {
  let t: TestApp;
  let db: TestDb;
  let routes: Route[];

  const call = (cookie: string | null, method: Method, url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1');
    if (cookie) r.set('Cookie', cookie);
    return body === undefined ? r : r.send(body as object);
  };

  async function login(role: 'USER' | 'MODERATOR' | 'ADMIN' = 'USER'): Promise<{ cookie: string; id: string }> {
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

  const fill = (path: string, ids: Record<string, string>) => path.replace(/:(\w+)/g, (_m, name: string) => ids[name] ?? 'net-takogo');

  beforeAll(async () => {
    db = await createTestDb();
    const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
    const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
    t = await startTestApp({ db: db.db, otpSender, captchaVerifier });

    const reflector = t.app.get(Reflector);
    const scanner = new MetadataScanner();
    const found: Route[] = [];
    for (const w of [...t.app.get(ModulesContainer).values()].flatMap((m) => [...m.controllers.values()])) {
      if (!w.instance || !w.metatype) continue;
      const proto = Object.getPrototypeOf(w.instance) as Record<string, unknown>;
      const base = (Reflect.getMetadata('path', w.metatype) as string | undefined) ?? '';
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name] as object;
        const sub = Reflect.getMetadata('path', handler) as string | undefined;
        const verb = Reflect.getMetadata('method', handler) as number | undefined;
        if (sub === undefined || verb === undefined) continue;
        const path = `/${base}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        const method = METHODS[verb]!;
        found.push({
          key: `${method.toUpperCase()} ${path}`,
          method,
          path,
          isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY as never, [handler as never, w.metatype]) === true,
          roles: reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler as never, w.metatype]) ?? [],
        });
      }
    }
    routes = found;
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('N-04 · у каждого маршрута есть решение: открытый, по роли, только свой сеанс или объект по идентификатору — новый маршрут без записи ломает тест', () => {
    expect(routes.length).toBeGreaterThan(100);
    const keys = routes.map((r) => r.key);
    expect(new Set(keys).size, 'маршруты не повторяются').toBe(keys.length);
    const undecided = routes.filter((r) => !r.isPublic && r.roles.length === 0 && !OWN_SESSION.has(r.key) && !BY_ID.has(r.key)).map((r) => r.key);
    expect(undecided, 'маршруты без решения о доступе: добавьте их в OWN_SESSION или BY_ID (security.test.ts) либо закройте ролью').toEqual([]);
    const stale = [...OWN_SESSION, ...BY_ID].filter((k) => !keys.includes(k));
    expect(stale, 'в таблицах есть маршруты, которых уже нет').toEqual([]);
    const both = [...OWN_SESSION].filter((k) => BY_ID.has(k));
    expect(both).toEqual([]);
    // Открытый или закрытый ролью маршрут не может одновременно числиться «своим» или «по идентификатору».
    expect(routes.filter((r) => (r.isPublic || r.roles.length > 0) && (OWN_SESSION.has(r.key) || BY_ID.has(r.key))).map((r) => r.key)).toEqual([]);
  });

  it('N-04 · все маршруты админки закрыты ролью, а маршруты кабинета и аккаунта — сеансом; открыты только перечисленные', () => {
    const open = routes.filter((r) => r.isPublic).map((r) => r.key).sort();
    const prefixes = ['/health', '/auth/otp/', '/auth/oauth/', '/legal/', '/auth/account/email/verify', '/dev/oauth/', '/flags/public', '/play/', '/reports', '/plans'];
    expect(open.filter((k) => !prefixes.some((p) => k.split(' ')[1]!.startsWith(p)))).toEqual([]);
    for (const r of routes.filter((x) => x.path.startsWith('/admin'))) expect(r.roles.length, r.key).toBeGreaterThan(0);
    for (const r of routes.filter((x) => x.path.startsWith('/projects') || x.path.startsWith('/themes') || x.path.startsWith('/media'))) expect(r.isPublic, r.key).toBe(false);
    for (const r of routes.filter((x) => x.roles.includes('ADMIN') && !x.roles.includes('MODERATOR'))) expect(r.roles, r.key).toEqual(['ADMIN']);
  });

  it('N-04 · без входа каждый закрытый маршрут отвечает 401, а пользователь без роли у маршрутов по роли — 403', async () => {
    const user = await login();
    const closed = routes.filter((r) => !r.isPublic);
    expect(closed.length).toBeGreaterThan(80);
    const bad: string[] = [];
    for (const r of closed) {
      const url = fill(r.path, {});
      const anon = await call(null, r.method, url, r.method === 'get' || r.method === 'delete' ? undefined : {});
      if (anon.status !== 401) bad.push(`${r.key}: без входа ${anon.status}`);
      if (r.roles.length > 0) {
        const plain = await call(user.cookie, r.method, url, r.method === 'get' || r.method === 'delete' ? undefined : {});
        if (plain.status !== 403) bad.push(`${r.key}: обычный пользователь ${plain.status}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('N-04 · модератору закрыты маршруты, которые только для администратора', async () => {
    const moderator = await login('MODERATOR');
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.roles.length === 1 && x.roles[0] === 'ADMIN')) {
      const res = await call(moderator.cookie, r.method, fill(r.path, {}), r.method === 'get' || r.method === 'delete' ? undefined : {});
      if (res.status !== 403) bad.push(`${r.key}: модератор ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('N-04 · IDOR: чужой пользователь не получает и не меняет объекты автора ни одним маршрутом по идентификатору', async () => {
    const owner = await login();
    const other = await login();

    // Объекты автора: сборка с опубликованной копией, точка доступа, прохождение, тема, файл, сообщение, версия, сеанс входа.
    const created = (await call(owner.cookie, 'post', '/projects', { title: 'Чужая сборка' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(owner.cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(owner.cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    const projectId = created.id;
    const accessPointId = ((await call(owner.cookie, 'post', `/projects/${projectId}/access-points`, { label: 'Свой' }).expect(200)).body as { id: string }).id;
    const started = (await request(t.http()).post(`/${API_PREFIX}/play/${projectId}/sessions`).set('X-Blokum-CSRF', '1').send({}).expect(201)).body as { sessionId?: string; id?: string };
    const responseId = (started.sessionId ?? started.id)!;
    const themeId = ((await call(owner.cookie, 'post', '/themes', { name: 'Моя тема' }).expect(201)).body as { id: string }).id;
    const [media] = await db.db.insert(schema.media).values({ ownerId: owner.id, kind: 'IMAGE', status: 'READY', mime: 'image/png', bytes: 10, sha256: 'x'.repeat(8), storageKey: `${owner.id}/k` } as never).returning({ id: schema.media.id });
    const [note] = await db.db.insert(schema.notifications).values({ userId: owner.id, kind: 'TEST', title: 'Тест', body: 'Тест' }).returning({ id: schema.notifications.id });
    const versions = (await call(owner.cookie, 'get', `/projects/${projectId}/versions`).expect(200)).body as Array<{ id: string }> | { items: Array<{ id: string }> };
    const versionId = (Array.isArray(versions) ? versions : versions.items)[0]!.id;
    const [session] = await db.db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, owner.id));
    const uploadId = ((await call(owner.cookie, 'post', '/media/sessions', { totalBytes: 100 })).body as { sessionId: string }).sessionId;
    const ids: Record<string, string> = { projectId, accessPointId, themeId, versionId };
    const idsFor = (path: string): Record<string, string> => {
      if (path.startsWith('/projects/:projectId/responses/:id')) return { ...ids, id: responseId };
      if (path.startsWith('/projects/:projectId/access-points/:id')) return { ...ids, id: accessPointId };
      if (path.startsWith('/themes/:id')) return { ...ids, id: themeId };
      if (path.startsWith('/media/sessions/')) return { ...ids, id: uploadId };
      if (path.startsWith('/media/')) return { ...ids, id: media!.id };
      if (path.startsWith('/notifications/')) return { ...ids, id: note!.id };
      if (path.startsWith('/auth/sessions/')) return { ...ids, id: session!.id };
      return { ...ids, id: projectId };
    };

    const bad: string[] = [];
    for (const r of routes.filter((x) => BY_ID.has(x.key))) {
      const url = fill(r.path, idsFor(r.path));
      // Тело подходит маршруту, чтобы отказ шёл от проверки владельца, а не от проверки тела.
      const body = r.method === 'get' || r.method === 'delete' ? undefined : r.path.endsWith('/appeals') ? { text: 'Прошу пересмотреть это решение.' } : r.path.endsWith('/draft') ? { document: created.document } : {};
      const req = r.path === '/media/sessions/:id' ? call(other.cookie, r.method, url).set('Content-Type', 'application/octet-stream').send(Buffer.from('чужие байты')) : call(other.cookie, r.method, url, body);
      if (r.method === 'put' && r.path.endsWith('/draft')) req.set('If-Match', String(created.draftVersionNumber));
      const res = await req.timeout({ response: 4000, deadline: 8000 }).catch((e: unknown) => ({ status: `ждали больше 4 секунд (${String((e as Error).message)})` }));
      // Не 2xx и не 3xx: «нет такого» или «нельзя». Ошибка проверки тела (422) до проверки владельца — тоже недопустима.
      if (res.status !== 403 && res.status !== 404) bad.push(`${r.key}: чужой пользователь получил ${String(res.status)}`);
    }
    expect(bad).toEqual([]);

    // Ничего из объектов автора не пострадало.
    await call(owner.cookie, 'get', `/projects/${projectId}`).expect(200);
    await call(owner.cookie, 'get', `/projects/${projectId}/access-points`).expect(200);
    await call(owner.cookie, 'get', `/themes/${themeId}`).expect(200);
    // Чужие байты не попали в загрузку автора.
    expect(((await call(owner.cookie, 'put', `/media/sessions/${uploadId}`).set('Content-Type', 'application/octet-stream').send(Buffer.from('мои')).expect(200)).body as { received: number }).received).toBe(Buffer.byteLength('мои'));
    expect((await db.db.select().from(schema.media).where(eq(schema.media.id, media!.id)))[0]!.status).toBe('READY');
    expect((await db.db.select().from(schema.notifications).where(eq(schema.notifications.id, note!.id)))[0]!.readAt).toBeNull();
    expect((await db.db.select().from(schema.sessions).where(eq(schema.sessions.id, session!.id)))[0]!.revokedAt).toBeNull();
  });

  it('N-04 · списки показывают только своё: чужой пользователь не видит ни сборок, ни тем, ни файлов, ни сообщений автора', async () => {
    const owner = await login();
    const other = await login();
    await call(owner.cookie, 'post', '/projects', { title: 'Только моя' }).expect(200);
    await call(owner.cookie, 'post', '/themes', { name: 'Только моя тема' }).expect(201);
    await db.db.insert(schema.notifications).values({ userId: owner.id, kind: 'TEST', title: 'Личное', body: 'Личное' });
    const text = async (url: string) => JSON.stringify((await call(other.cookie, 'get', url).expect(200)).body);
    expect(await text('/projects')).not.toContain('Только моя');
    expect(await text('/themes')).not.toContain('Только моя тема');
    expect(await text('/notifications')).not.toContain('Личное');
    expect(await text('/media')).not.toContain(owner.id);
  });

  it('ASVS V3.3.2 · сеанс заканчивается через 30 дней после входа, даже если им пользовались вчера; через 14 дней без использования — тоже', async () => {
    const user = await login();
    await call(user.cookie, 'get', '/auth/me').expect(200);
    const day = 24 * 3_600_000;
    // Вход 29 дней назад, пользовались вчера: ещё действует, но срок не уходит дальше 30-го дня.
    await db.db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 29 * day) }).where(eq(schema.sessions.userId, user.id));
    await call(user.cookie, 'get', '/auth/me').expect(200);
    const [row] = await db.db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id));
    expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(row!.createdAt.getTime() + 30 * day + 1000);
    // Вход 31 день назад: сеанс недействителен, хотя срок «без использования» не вышел.
    await db.db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 31 * day), expiresAt: new Date(Date.now() + 10 * day) }).where(eq(schema.sessions.userId, user.id));
    await call(user.cookie, 'get', '/auth/me').expect(401);
    // Без использования 15 дней: срок «без использования» вышел.
    const idle = await login();
    await db.db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.userId, idle.id));
    await call(idle.cookie, 'get', '/auth/me').expect(401);
  });

  it('ASVS V8.1.1 · ответы API с личными данными не кэшируются; файлы называют свой срок сами', async () => {
    const user = await login();
    expect((await call(user.cookie, 'get', '/auth/me').expect(200)).headers['cache-control']).toBe('no-store');
    expect((await call(null, 'get', '/flags/public').expect(200)).headers['cache-control']).toBe('no-store');
    expect((await call(user.cookie, 'get', '/notifications').expect(200)).headers['cache-control']).toBe('no-store');
  });

  it('ASVS V14.3.3, V14.4.2 · ответ API не называет сервер и не показывается как документ; файлы называют своё', async () => {
    const user = await login();
    const res = await call(user.cookie, 'get', '/auth/me').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-disposition']).toBe('attachment; filename="api.json"');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('ASVS V5.2.3 · название сборки с переводами строк не попадает в тему письма как есть', async () => {
    const owner = await login();
    const sent: string[] = [];
    const { NotificationsService } = await import('../src/admin/notifications.service.js');
    const svc = new NotificationsService(db.db, { sendVerification: () => Promise.resolve(), sendNotice: (_to: string, subject: string) => (sent.push(subject), Promise.resolve()) });
    await db.db.update(schema.users).set({ email: 'a@example.ru', emailVerifiedAt: new Date() }).where(eq(schema.users.id, owner.id));
    await svc.notify({ userId: owner.id, kind: 'TEST', title: 'Сборка «Тема\r\nBcc: evil@example.ru» заблокирована', body: 'Текст' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toMatch(/[\r\n]/);
    expect(sent[0]).toContain('Bcc: evil@example.ru');
    const [row] = await db.db.select().from(schema.notifications).where(eq(schema.notifications.userId, owner.id));
    expect(row!.title).not.toMatch(/[\r\n]/);
  });

  it('ASVS V5.1.2 · настройки доступа: лишние поля из тела не попадают в сохранённые, неверные типы — 400', async () => {
    const owner = await login();
    const id = ((await call(owner.cookie, 'post', '/projects', { title: 'Настройки' }).expect(200)).body as { id: string }).id;
    await call(owner.cookie, 'patch', `/projects/${id}/access-settings`, { maxStarts: 5, passwordHash: 'подделка', chtoto: 'лишнее', unlockSalt: 'x', closedText: 'Закрыто' }).expect(200);
    const [row] = await db.db.select({ settings: schema.projects.settings }).from(schema.projects).where(eq(schema.projects.id, id));
    expect(row!.settings).toMatchObject({ maxStarts: 5, closedText: 'Закрыто' });
    expect(Object.keys(row!.settings).sort()).toEqual(['closedText', 'maxStarts']);
    await call(owner.cookie, 'patch', `/projects/${id}/access-settings`, { age18: 'да' }).expect(400);
    await call(owner.cookie, 'patch', `/projects/${id}/access-settings`, { scheduledOpenAt: 'вчера' }).expect(400);
    await call(owner.cookie, 'patch', `/projects/${id}/access-settings`, { closedText: 'я'.repeat(1001) }).expect(400);
  });
});
