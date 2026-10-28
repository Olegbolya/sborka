import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { and, eq } from 'drizzle-orm';
import { createBlock, createScreen, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];

const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get' | 'delete', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const open = (t: TestApp, method: 'get' | 'post', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set({ 'X-Blokum-CSRF': '1' });
  return body === undefined ? r : r.send(body as object);
};

describe('P9.3 · AD-02, AD-03, AD-04, AD-07, AD-09, AD-11 · админка модерации и контента', () => {
  let t: TestApp;
  let db: TestDb;

  async function login(role: 'USER' | 'MODERATOR' | 'ADMIN' = 'USER'): Promise<{ cookie: string; id: string }> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    // The role is read from the database on every request, so the session made above works for it at once.
    if (role !== 'USER') await db.db.update(schema.users).set({ role }).where(eq(schema.users.id, u!.id));
    return { cookie, id: u!.id };
  }

  async function publishedBy(cookie: string): Promise<{ id: string; slug: string }> {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Конкурс' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, slug: created.slug };
  }
  const projectRow = async (id: string) => (await db.db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0]!;
  const audit = async (action: string, targetId?: string) =>
    (await db.db.select().from(schema.auditLog)).filter((r) => r.action === action && (targetId === undefined || r.targetId === targetId));

  beforeAll(async () => {
    db = await createTestDb();
    const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
    const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
    t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('AD-01 · админка закрыта для обычных пользователей и для гостей; выключатели и системное — только администратору', async () => {
    const user = await login();
    const moderator = await login('MODERATOR');
    await call(t, user.cookie, 'get', '/admin/queue').expect(403);
    await call(t, user.cookie, 'get', '/admin/users?q=ab').expect(403);
    await open(t, 'get', '/admin/queue').expect(401);
    await call(t, moderator.cookie, 'get', '/admin/queue').expect(200);
    for (const [method, url] of [['get', '/admin/flags'], ['get', '/admin/system'], ['get', '/admin/audit'], ['get', '/admin/templates'], ['get', '/admin/themes']] as const) {
      await call(t, moderator.cookie, method, url).expect(403);
    }
  });

  it('AD-03 · жалоба P0 сама снимает сборку с публикации, пишет решение «система» в историю, сообщает владельцу и поднимает тревогу', async () => {
    const owner = await login();
    const p = await publishedBy(owner.cookie);
    await open(t, 'get', `/play/${p.slug}`).expect(200);
    await open(t, 'post', '/reports', { slug: p.slug, category: 'A2', text: 'Просят пароль от почты' }).expect(201);

    expect(await projectRow(p.id)).toMatchObject({ status: 'CLOSED', moderationStatus: 'FLAGGED' });
    await open(t, 'get', `/play/${p.slug}`).expect(404);
    const [action] = await db.db.select().from(schema.moderationActions).where(eq(schema.moderationActions.targetId, p.id));
    expect(action).toMatchObject({ action: 'UNPUBLISH', reasonCode: 'AUTO_P0', actorId: 'system' });
    const notes = (await call(t, owner.cookie, 'get', '/notifications').expect(200)).body as Array<{ title: string; body: string }>;
    expect(notes[0]!.title).toContain('снята с публикации');
    expect(notes[0]!.body).toContain('временно снята');
    expect(t.alerts.some((a) => a.key === `report-p0:${p.id}` && a.severity === 'critical')).toBe(true);
    expect((await audit('MODERATION_UNPUBLISH', p.id))).toHaveLength(1);
  });

  it('AD-03 · три независимых жалобы за час делают жалобу срочной даже в лёгкой категории', async () => {
    const owner = await login();
    const p = await publishedBy(owner.cookie);
    const seed = ['aaaa', 'bbbb'].map((h) => ({ projectId: p.id, category: 'B10', text: 'Спам какой-то', reporterIpHash: h, priority: 'P2' as const, slaDueAt: new Date(Date.now() + 72 * 3_600_000) }));
    await db.db.insert(schema.reports).values(seed);
    expect((await projectRow(p.id)).status).toBe('PUBLISHED');
    await open(t, 'post', '/reports', { slug: p.slug, category: 'B10', text: 'Опять спам и реклама' }).expect(201);
    expect((await projectRow(p.id)).status).toBe('CLOSED');
    const rows = await db.db.select().from(schema.reports).where(eq(schema.reports.projectId, p.id));
    expect(rows.filter((r) => r.priority === 'P0')).toHaveLength(1);
  });

  it('AD-03 · полный цикл: жалоба P0 → автоснятие → очередь → BLOCK_PROJECT → письмо → обжалование → другой модератор → RESTORE; всё в аудите', async () => {
    const owner = await login();
    const first = await login('MODERATOR');
    const second = await login('MODERATOR');
    const admin = await login('ADMIN');
    const p = await publishedBy(owner.cookie);
    await open(t, 'post', '/reports', { slug: p.slug, category: 'A4', text: 'Призывы к беспорядкам в тексте' }).expect(201);

    // Очередь: случай виден с приоритетом, сроком и ссылкой на сборку.
    const queue = (await call(t, first.cookie, 'get', '/admin/queue').expect(200)).body as Array<{ id: string; priority: string; projectId: string; remainingMs: number; categoryLabel: string }>;
    const item = queue.find((q) => q.projectId === p.id)!;
    expect(item).toMatchObject({ priority: 'P0' });
    expect(item.remainingMs).toBeLessThanOrEqual(3_600_000);
    expect(queue[0]!.priority).toBe('P0');
    const detail = (await call(t, first.cookie, 'get', `/admin/cases/${item.id}`).expect(200)).body as { snapshot: { screens: unknown[] }; project: { status: string }; history: Array<{ action: string; actorId: string }> };
    expect(detail.project.status).toBe('CLOSED');
    expect(detail.snapshot.screens).toHaveLength(2);
    expect(detail.history[0]).toMatchObject({ action: 'UNPUBLISH', actorId: 'system' });
    await call(t, first.cookie, 'post', `/admin/cases/${item.id}/take`).expect(204);
    await call(t, second.cookie, 'post', `/admin/cases/${item.id}/take`).expect(409);

    // Решение требует причину из списка и комментарий.
    const decision = { targetType: 'PROJECT', targetId: p.id, action: 'BLOCK_PROJECT', reportId: item.id };
    await call(t, first.cookie, 'post', '/admin/actions', { ...decision, reasonCode: 'ЧТО-ТО', note: 'Нарушение подтвердилось' }).expect(422);
    await call(t, first.cookie, 'post', '/admin/actions', { ...decision, reasonCode: 'A4', note: '' }).expect(422);
    await call(t, first.cookie, 'post', '/admin/actions', { ...decision, action: 'BLOCK_MEDIA', reasonCode: 'A4', note: 'Нарушение подтвердилось' }).expect(422);
    await call(t, first.cookie, 'post', '/admin/actions', { ...decision, reasonCode: 'A4', note: 'Нарушение подтвердилось' }).expect(201);

    expect(await projectRow(p.id)).toMatchObject({ status: 'BLOCKED', moderationStatus: 'BLOCKED' });
    const [report] = await db.db.select().from(schema.reports).where(eq(schema.reports.id, item.id));
    expect(report).toMatchObject({ status: 'RESOLVED', assigneeId: first.id });

    // Письмо: сообщение владельцу с причиной, комментарием и порядком обжалования.
    const notes = (await call(t, owner.cookie, 'get', '/notifications').expect(200)).body as Array<{ title: string; body: string; kind: string }>;
    const blocked = notes.find((n) => n.kind === 'MODERATION_BLOCK_PROJECT')!;
    expect(blocked.title).toContain('заблокирована');
    expect(blocked.body).toContain('Нарушение подтвердилось');
    expect(blocked.body).toContain('Обжаловать');

    // Обжалование: создатель видит причину; отправляет обращение; своё решение первый модератор сразу пересматривать не может.
    const view = (await call(t, owner.cookie, 'get', `/projects/${p.id}/moderation`).expect(200)).body as { moderated: boolean; canAppeal: boolean; history: Array<{ action: string }> };
    expect(view).toMatchObject({ moderated: true, canAppeal: true });
    await call(t, owner.cookie, 'post', `/projects/${p.id}/appeals`, { text: 'коротко' }).expect(422);
    const appealId = ((await call(t, owner.cookie, 'post', `/projects/${p.id}/appeals`, { text: 'Это учебный конкурс по истории, призывов в нём нет.' }).expect(201)).body as { id: string }).id;
    await call(t, owner.cookie, 'post', `/projects/${p.id}/appeals`, { text: 'Это учебный конкурс по истории, призывов в нём нет.' }).expect(409);
    expect(((await call(t, owner.cookie, 'get', `/projects/${p.id}/moderation`).expect(200)).body as { canAppeal: boolean }).canAppeal).toBe(false);
    await call(t, owner.cookie, 'get', '/admin/appeals').expect(403);
    const listed = (await call(t, second.cookie, 'get', '/admin/appeals').expect(200)).body as Array<{ id: string; projectTitle: string; actionLabel: string }>;
    expect(listed.find((a) => a.id === appealId)).toMatchObject({ projectTitle: 'Конкурс', actionLabel: 'Заблокировать сборку' });
    expect((await call(t, first.cookie, 'post', `/admin/appeals/${appealId}/decide`, { decision: 'GRANT', note: 'Сам пересматриваю' }).expect(409)).body.error.code).toBe('SAME_MODERATOR');
    await call(t, second.cookie, 'post', `/admin/appeals/${appealId}/decide`, { decision: 'GRANT', note: 'Проверил: призывов нет' }).expect(204);

    // RESTORE вернул сборку в состояние до модерации, то есть в публикацию.
    expect(await projectRow(p.id)).toMatchObject({ status: 'PUBLISHED', moderationStatus: 'NONE', closedReason: null });
    await open(t, 'get', `/play/${p.slug}`).expect(200);
    const after = (await call(t, owner.cookie, 'get', `/projects/${p.id}/moderation`).expect(200)).body as { moderated: boolean; appeals: Array<{ status: string; decisionNote: string }> };
    expect(after.moderated).toBe(false);
    expect(after.appeals[0]).toMatchObject({ status: 'GRANTED', decisionNote: 'Проверил: призывов нет' });
    const notes2 = (await call(t, owner.cookie, 'get', '/notifications').expect(200)).body as Array<{ kind: string }>;
    expect(notes2.map((n) => n.kind)).toContain('MODERATION_RESTORE');

    // Все шаги — в журнале аудита, который видит только администратор.
    const log = (await call(t, admin.cookie, 'get', `/admin/audit?limit=200`).expect(200)).body as Array<{ action: string }>;
    const names = log.map((r) => r.action);
    for (const a of ['MODERATION_UNPUBLISH', 'REPORT_TAKEN', 'MODERATION_BLOCK_PROJECT', 'APPEAL_CREATED', 'MODERATION_RESTORE', 'APPEAL_GRANTED']) expect(names, a).toContain(a);
    const history = (await call(t, first.cookie, 'get', `/admin/cases/${item.id}`).expect(200)).body as { history: Array<{ action: string }> };
    expect(history.history.map((h) => h.action)).toEqual(['RESTORE', 'BLOCK_PROJECT', 'UNPUBLISH']);
    // Журнал нельзя исправить: изменения и удаление отвергает база.
    await expect(db.db.delete(schema.auditLog)).rejects.toThrow();
  });

  it('AD-03 · «жалоба не подтвердилась» отменяет автоматическое снятие; отклонённое обжалование оставляет решение и сообщает владельцу', async () => {
    const owner = await login();
    const moderator = await login('MODERATOR');
    const p = await publishedBy(owner.cookie);
    await open(t, 'post', '/reports', { slug: p.slug, category: 'A5', text: 'Угрожают расправой' }).expect(201);
    const [r] = await db.db.select().from(schema.reports).where(eq(schema.reports.projectId, p.id));
    expect((await projectRow(p.id)).status).toBe('CLOSED');
    await call(t, moderator.cookie, 'post', `/admin/cases/${r!.id}/dismiss`, { note: '' }).expect(422);
    await call(t, moderator.cookie, 'post', `/admin/cases/${r!.id}/dismiss`, { note: 'Это цитата из учебника' }).expect(204);
    expect(await projectRow(p.id)).toMatchObject({ status: 'PUBLISHED', moderationStatus: 'NONE' });
    await call(t, moderator.cookie, 'post', `/admin/cases/${r!.id}/dismiss`, { note: 'Ещё раз' }).expect(409);

    // Отказ по обращению.
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'PROJECT', targetId: p.id, action: 'UNPUBLISH', reasonCode: 'B10', note: 'Спам' }).expect(201);
    expect(((await call(t, owner.cookie, 'get', `/projects/${p.id}/moderation`).expect(200)).body as { resubmit: boolean }).resubmit).toBe(true);
    const other = await login('MODERATOR');
    const appealId = ((await call(t, owner.cookie, 'post', `/projects/${p.id}/appeals`, { text: 'Исправил текст, проверьте ещё раз.' }).expect(201)).body as { id: string }).id;
    await call(t, other.cookie, 'post', `/admin/appeals/${appealId}/decide`, { decision: 'DENY', note: 'Текст остался прежним' }).expect(204);
    await call(t, other.cookie, 'post', `/admin/appeals/${appealId}/decide`, { decision: 'DENY', note: 'Ещё раз' }).expect(409);
    expect((await projectRow(p.id)).status).toBe('CLOSED');
    const notes = (await call(t, owner.cookie, 'get', '/notifications').expect(200)).body as Array<{ kind: string; body: string }>;
    expect(notes.find((n) => n.kind === 'APPEAL_DENIED')!.body).toContain('Текст остался прежним');
    // Восстанавливать нечего, когда последнее решение уже отменено.
    await call(t, other.cookie, 'post', '/admin/actions', { targetType: 'PROJECT', targetId: p.id, action: 'RESTORE', reasonCode: 'MISTAKE', note: 'Ошибочно закрыли' }).expect(201);
    expect((await call(t, other.cookie, 'post', '/admin/actions', { targetType: 'PROJECT', targetId: p.id, action: 'RESTORE', reasonCode: 'MISTAKE', note: 'Второй раз' }).expect(409)).body.error.code).toBe('NOTHING_TO_RESTORE');
  });

  it('AD-02 · блокировка аккаунта закрывает сессии, а вход для категории A отвечает без подробностей; администратора заблокировать нельзя', async () => {
    const victim = await login();
    const moderator = await login('MODERATOR');
    const admin = await login('ADMIN');
    await call(t, victim.cookie, 'get', '/auth/account').expect(200);
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'USER', targetId: admin.id, action: 'BLOCK_USER', reasonCode: 'OTHER', note: 'Пробую' }).expect(403);
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'USER', targetId: moderator.id, action: 'BLOCK_USER', reasonCode: 'OTHER', note: 'Пробую' }).expect(409);
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'USER', targetId: victim.id, action: 'BLOCK_USER', reasonCode: 'A1', note: 'Материалы категории A1' }).expect(201);
    await call(t, victim.cookie, 'get', '/auth/account').expect(401);
    const [notice] = await db.db.select().from(schema.notifications).where(eq(schema.notifications.userId, victim.id));
    expect(notice!.body).toBe('Аккаунт заблокирован за нарушение правил сервиса.');
    const profile = (await call(t, moderator.cookie, 'get', `/admin/users/${victim.id}`).expect(200)).body as { user: { status: string }; history: Array<{ action: string }> };
    expect(profile.user.status).toBe('BLOCKED');
    expect(profile.history[0]!.action).toBe('BLOCK_USER');
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'USER', targetId: victim.id, action: 'RESTORE', reasonCode: 'MISTAKE', note: 'Ошиблись' }).expect(201);
    expect(((await call(t, moderator.cookie, 'get', `/admin/users/${victim.id}`).expect(200)).body as { user: { status: string } }).user.status).toBe('ACTIVE');
  });

  it('AD-02 · поиск пользователей: по имени, номеру в VK ID и по идентификатору; профиль со сборками и платежами', async () => {
    const owner = await login();
    const moderator = await login('MODERATOR');
    await db.db.update(schema.users).set({ displayName: 'Мария Редкая' }).where(eq(schema.users.id, owner.id));
    await db.db.insert(schema.authIdentities).values({ userId: owner.id, provider: 'VK', providerUserId: '987654321' });
    await db.db.insert(schema.orders).values({ userId: owner.id, kind: 'SUBSCRIPTION', item: { plan: 'PRO' }, amountKop: 49000, provider: 'dev' });
    const p = await publishedBy(owner.cookie);
    await call(t, moderator.cookie, 'get', '/admin/users?q=м').expect(422);
    for (const q of ['Редкая', '987654321', owner.id]) {
      const found = (await call(t, moderator.cookie, 'get', `/admin/users?q=${encodeURIComponent(q)}`).expect(200)).body as Array<{ id: string }>;
      expect(found.map((u) => u.id), q).toContain(owner.id);
    }
    const profile = (await call(t, moderator.cookie, 'get', `/admin/users/${owner.id}`).expect(200)).body as { identities: unknown[]; projects: Array<{ id: string }>; orders: Array<{ amountKop: number }> };
    expect(profile.identities).toEqual([{ provider: 'VK', providerUserId: '987654321' }]);
    expect(profile.projects.map((x) => x.id)).toContain(p.id);
    expect(profile.orders[0]!.amountKop).toBe(49000);
    await call(t, moderator.cookie, 'get', '/admin/users/net-takogo').expect(404);
  });

  it('AD-04 · заявление правообладателя: срок 24 часа, одно уточнение, снятие материала; требования госорганов: действия и закрытие', async () => {
    const owner = await login();
    const moderator = await login('MODERATOR');
    const p = await publishedBy(owner.cookie);
    await call(t, moderator.cookie, 'post', '/admin/copyright-claims', { claimant: 'ООО «Автор»', objectDescription: 'Фотография', urls: [], statement: 'Права нарушены' }).expect(422);
    const id = ((await call(t, moderator.cookie, 'post', '/admin/copyright-claims', { claimant: 'ООО «Автор»', objectDescription: 'Фотография на втором экране', urls: [`https://blokum.ru/s/${p.slug}`], statement: 'Права нарушены', projectId: p.id }).expect(201)).body as { id: string }).id;
    const claims = (await call(t, moderator.cookie, 'get', '/admin/copyright-claims').expect(200)).body as Array<{ id: string; remainingMs: number; overdue: boolean; open: boolean }>;
    const claim = claims.find((c) => c.id === id)!;
    expect(claim).toMatchObject({ overdue: false, open: true });
    expect(claim.remainingMs).toBeGreaterThan(23 * 3_600_000);
    await call(t, moderator.cookie, 'post', `/admin/copyright-claims/${id}/clarify`).expect(204);
    expect((await call(t, moderator.cookie, 'post', `/admin/copyright-claims/${id}/clarify`).expect(409)).body.error.code).toBe('CLARIFY_ONCE');
    await call(t, moderator.cookie, 'post', `/admin/copyright-claims/${id}/resolve`, { outcome: 'REMOVED', note: '' }).expect(422);
    await call(t, moderator.cookie, 'post', `/admin/copyright-claims/${id}/resolve`, { outcome: 'REMOVED', note: 'Фото снято по заявлению' }).expect(204);
    expect((await projectRow(p.id)).status).toBe('CLOSED');
    await call(t, moderator.cookie, 'post', `/admin/copyright-claims/${id}/resolve`, { outcome: 'REMOVED', note: 'Ещё раз' }).expect(409);
    const after = ((await call(t, moderator.cookie, 'get', '/admin/copyright-claims').expect(200)).body as Array<{ id: string; status: string; strikes: number }>).find((c) => c.id === id)!;
    expect(after).toMatchObject({ status: 'REMOVED', strikes: 1 });

    const now = Date.now();
    const authority = { source: 'Роскомнадзор', number: 'РКН-17/2026', subject: 'Требование об удалении материала', receivedAt: new Date(now - 3_600_000).toISOString(), dueAt: new Date(now + 24 * 3_600_000).toISOString() };
    await call(t, moderator.cookie, 'post', '/admin/authority-requests', { ...authority, dueAt: authority.receivedAt }).expect(422);
    const rid = ((await call(t, moderator.cookie, 'post', '/admin/authority-requests', authority).expect(201)).body as { id: string }).id;
    expect((await call(t, moderator.cookie, 'post', `/admin/authority-requests/${rid}/close`).expect(409)).body.error.code).toBe('NO_ACTIONS');
    await call(t, moderator.cookie, 'post', `/admin/authority-requests/${rid}/actions`, { action: 'Материал снят, ответ отправлен' }).expect(204);
    await call(t, moderator.cookie, 'post', `/admin/authority-requests/${rid}/close`).expect(204);
    const list = (await call(t, moderator.cookie, 'get', '/admin/authority-requests').expect(200)).body as Array<{ id: string; status: string; actions: unknown[] }>;
    expect(list.find((r) => r.id === rid)).toMatchObject({ status: 'CLOSED' });
    expect(list.find((r) => r.id === rid)!.actions).toHaveLength(1);
  });

  it('AD-07 · выключатели: действуют без перезапуска, нужна причина, пишутся в аудит и в тревоги; плеер, публикация, загрузка, регистрация и СМС закрываются', async () => {
    const owner = await login();
    const admin = await login('ADMIN');
    const p = await publishedBy(owner.cookie);
    const flags = (await call(t, admin.cookie, 'get', '/admin/flags').expect(200)).body as Array<{ key: string; enabled: boolean }>;
    expect(flags.map((f) => f.key)).toEqual(['REGISTRATION_ENABLED', 'UPLOADS_ENABLED', 'PUBLISHING_ENABLED', 'PLAYER_ENABLED', 'EXTERNAL_LINKS_ENABLED', 'SMS_ENABLED']);
    expect(flags.every((f) => f.enabled)).toBe(true);
    await call(t, admin.cookie, 'put', '/admin/flags/PLAYER_ENABLED', { enabled: false, note: '' }).expect(422);
    await call(t, admin.cookie, 'put', '/admin/flags/NO_SUCH', { enabled: false, note: 'проверка' }).expect(404);

    await call(t, admin.cookie, 'put', '/admin/flags/PLAYER_ENABLED', { enabled: false, note: 'Сбой, разбираемся' }).expect(200);
    await open(t, 'get', `/play/${p.slug}`).expect(404);
    expect(((await open(t, 'get', '/flags/public').expect(200)).body as { player: boolean }).player).toBe(false);
    await call(t, admin.cookie, 'put', '/admin/flags/PLAYER_ENABLED', { enabled: true, note: '' }).expect(200);
    await open(t, 'get', `/play/${p.slug}`).expect(200);

    // Внешние ссылки: страница /out читает это значение (AD-07).
    await call(t, admin.cookie, 'put', '/admin/flags/EXTERNAL_LINKS_ENABLED', { enabled: false, note: 'Волна фишинга' }).expect(200);
    expect(((await open(t, 'get', '/flags/public').expect(200)).body as { externalLinks: boolean }).externalLinks).toBe(false);
    await call(t, admin.cookie, 'put', '/admin/flags/EXTERNAL_LINKS_ENABLED', { enabled: true, note: '' }).expect(200);
    expect(((await open(t, 'get', '/flags/public').expect(200)).body as { externalLinks: boolean }).externalLinks).toBe(true);

    await call(t, admin.cookie, 'put', '/admin/flags/PUBLISHING_ENABLED', { enabled: false, note: 'Волна спама' }).expect(200);
    expect((await call(t, owner.cookie, 'post', `/projects/${p.id}/publish`).expect(503)).body.error.code).toBe('FEATURE_DISABLED');
    await call(t, admin.cookie, 'put', '/admin/flags/PUBLISHING_ENABLED', { enabled: true, note: '' }).expect(200);

    await call(t, admin.cookie, 'put', '/admin/flags/SMS_ENABLED', { enabled: false, note: 'Кончились деньги на СМС' }).expect(200);
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: '+79001112233', captchaToken: 'ok' }).expect(503);
    await call(t, admin.cookie, 'put', '/admin/flags/SMS_ENABLED', { enabled: true, note: '' }).expect(200);

    await call(t, admin.cookie, 'put', '/admin/flags/UPLOADS_ENABLED', { enabled: false, note: 'Проверка вирусов не работает' }).expect(200);
    expect((await call(t, owner.cookie, 'post', '/media/sessions', { totalBytes: 1000 })).status).toBe(503);
    await call(t, admin.cookie, 'put', '/admin/flags/UPLOADS_ENABLED', { enabled: true, note: '' }).expect(200);

    const names = (await audit('FEATURE_DISABLED')).map((r) => r.targetId);
    expect(names).toEqual(expect.arrayContaining(['PLAYER_ENABLED', 'PUBLISHING_ENABLED', 'SMS_ENABLED', 'UPLOADS_ENABLED']));
    expect((await audit('FEATURE_ENABLED')).length).toBeGreaterThanOrEqual(4);
    expect(t.alerts.some((a) => a.key === 'feature-flag:PLAYER_ENABLED')).toBe(true);
  });

  it('AD-07 · выключатель регистрации не пускает новых пользователей, но уже зарегистрированные входят', async () => {
    const admin = await login('ADMIN');
    await call(t, admin.cookie, 'put', '/admin/flags/REGISTRATION_ENABLED', { enabled: false, note: 'Наплыв ботов' }).expect(200);
    const phone = '+79005550001';
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code });
    expect(res.status).toBe(503);
    await call(t, admin.cookie, 'put', '/admin/flags/REGISTRATION_ENABLED', { enabled: true, note: '' }).expect(200);
  });

  it('AD-09 · состояние системы: зависимости, диск, очереди файлов, работа, ждущая людей', async () => {
    const admin = await login('ADMIN');
    const state = (await call(t, admin.cookie, 'get', '/admin/system').expect(200)).body as {
      checks: { database: boolean; redis: boolean; diskUsedPct: number | null };
      queues: { mediaWaiting: number };
      backups: { configured: boolean };
      work: { P0: number; overdue: number; appeals: number; legalOverdue: number };
    };
    expect(state.checks).toEqual({ database: true, redis: true, diskUsedPct: 42 });
    expect(state.queues.mediaWaiting).toBeGreaterThanOrEqual(0);
    expect(state.backups).toEqual({ configured: false, newest: null });
    expect(Object.keys(state.work)).toEqual(expect.arrayContaining(['P0', 'P1', 'P2', 'overdue', 'appeals', 'legalOverdue']));
    const work = (await call(t, admin.cookie, 'get', '/admin/work').expect(200)).body as { appeals: number };
    expect(typeof work.appeals).toBe('number');
  });

  it('AD-11 · администратор публикует любую сборку как системный шаблон и тему — как системную, и снимает их; всё в аудите', async () => {
    const owner = await login();
    const admin = await login('ADMIN');
    const p = await publishedBy(owner.cookie);
    await call(t, owner.cookie, 'post', '/admin/templates', { projectId: p.id }).expect(403);
    await call(t, admin.cookie, 'post', '/admin/templates', {}).expect(422);
    await call(t, admin.cookie, 'post', '/admin/templates', { projectId: 'net-takoj' }).expect(404);
    const tid = ((await call(t, admin.cookie, 'post', '/admin/templates', { projectId: p.id, name: 'Викторина с баллами', category: 'Обучение', sort: 2 }).expect(201)).body as { id: string }).id;
    const templates = (await call(t, admin.cookie, 'get', '/admin/templates').expect(200)).body as Array<{ id: string; name: string; category: string; sort: number }>;
    expect(templates.find((x) => x.id === tid)).toMatchObject({ name: 'Викторина с баллами', category: 'Обучение', sort: 2 });
    const [row] = await db.db.select().from(schema.templates).where(eq(schema.templates.id, tid));
    expect(row).toMatchObject({ isSystem: true, ownerId: null, sourceProjectId: p.id });
    expect((row!.document as { screens: unknown[] }).screens).toHaveLength(2);
    await call(t, admin.cookie, 'patch', `/admin/templates/${tid}`, { name: 'Викторина', sort: 1 }).expect(204);
    await call(t, admin.cookie, 'patch', `/admin/templates/${tid}`, {}).expect(422);
    await call(t, admin.cookie, 'delete', `/admin/templates/${tid}`).expect(204);
    await call(t, admin.cookie, 'delete', `/admin/templates/${tid}`).expect(404);
    expect(((await call(t, admin.cookie, 'get', '/admin/templates').expect(200)).body as Array<{ id: string }>).some((x) => x.id === tid)).toBe(false);

    // Тема — из темы создателя и из темы внутри сборки; копия не зависит от исходной.
    const mine = (await call(t, owner.cookie, 'post', '/themes', { name: 'Моя тема' }).expect(201)).body as { id: string };
    await call(t, admin.cookie, 'post', '/admin/themes', { themeId: mine.id, projectId: p.id }).expect(422);
    const sid = ((await call(t, admin.cookie, 'post', '/admin/themes', { themeId: mine.id, name: 'Новогодний уют' }).expect(201)).body as { id: string }).id;
    const themes = (await call(t, admin.cookie, 'get', '/admin/themes').expect(200)).body as Array<{ id: string; name: string }>;
    expect(themes.find((x) => x.id === sid)!.name).toBe('Новогодний уют');
    const fromProject = ((await call(t, admin.cookie, 'post', '/admin/themes', { projectId: p.id }).expect(201)).body as { id: string }).id;
    // Системные темы видит любой создатель (TH-05).
    const listed = (await call(t, owner.cookie, 'get', '/themes?scope=system').expect(200)).body as Array<{ id: string }> | { items: Array<{ id: string }> };
    const ids = (Array.isArray(listed) ? listed : listed.items).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([sid, fromProject]));
    await call(t, admin.cookie, 'delete', `/admin/themes/${sid}`).expect(204);
    await call(t, admin.cookie, 'delete', `/admin/themes/${mine.id}`).expect(404);
    const kinds = (await call(t, admin.cookie, 'get', '/admin/audit?targetType=TEMPLATE').expect(200)).body as Array<{ action: string }>;
    expect(kinds.map((k) => k.action)).toEqual(expect.arrayContaining(['SYSTEM_TEMPLATE_PUBLISHED', 'SYSTEM_TEMPLATE_UPDATED', 'SYSTEM_TEMPLATE_REMOVED']));
    expect((await audit('SYSTEM_THEME_PUBLISHED')).length).toBe(2);
    expect((await audit('SYSTEM_THEME_REMOVED')).length).toBe(1);
  });

  it('AD-03 · блокировка файла и юридическое хранение отражаются на объекте; сообщение владельцу не уходит при хранении', async () => {
    const owner = await login();
    const moderator = await login('MODERATOR');
    const p = await publishedBy(owner.cookie);
    const [m] = await db.db.insert(schema.media).values({ ownerId: owner.id, kind: 'IMAGE', status: 'READY', mime: 'image/png', bytes: 10, sha256: 'x'.repeat(8), storageKey: `${owner.id}/k` } as never).returning({ id: schema.media.id });
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'MEDIA', targetId: m!.id, action: 'BLOCK_MEDIA', reasonCode: 'B6', note: 'Чужое фото' }).expect(201);
    expect((await db.db.select().from(schema.media).where(eq(schema.media.id, m!.id)))[0]!.status).toBe('BLOCKED');
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'MEDIA', targetId: m!.id, action: 'RESTORE', reasonCode: 'MISTAKE', note: 'Права подтверждены' }).expect(201);
    expect((await db.db.select().from(schema.media).where(eq(schema.media.id, m!.id)))[0]!.status).toBe('READY');

    const before = (await db.db.select().from(schema.notifications).where(eq(schema.notifications.userId, owner.id))).length;
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'PROJECT', targetId: p.id, action: 'LEGAL_HOLD', reasonCode: 'OTHER', note: 'По запросу органа' }).expect(201);
    expect((await projectRow(p.id)).legalHold).toBe(true);
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'PROJECT', targetId: p.id, action: 'RELEASE_HOLD', reasonCode: 'OTHER', note: 'Запрос закрыт' }).expect(201);
    expect((await projectRow(p.id)).legalHold).toBe(false);
    expect((await db.db.select().from(schema.notifications).where(eq(schema.notifications.userId, owner.id))).length).toBe(before);
    await call(t, moderator.cookie, 'post', '/admin/actions', { targetType: 'PROJECT', targetId: p.id, action: 'WARN', reasonCode: 'B8', note: 'Добавьте пометку' }).expect(201);
    const notes = (await call(t, owner.cookie, 'get', '/notifications').expect(200)).body as Array<{ id: string; kind: string; read: boolean }>;
    const warn = notes.find((n) => n.kind === 'MODERATION_WARN')!;
    expect(warn.read).toBe(false);
    await call(t, owner.cookie, 'post', `/notifications/${warn.id}/read`).expect(204);
    await call(t, owner.cookie, 'post', `/notifications/${warn.id}/read`).expect(204);
    await call(t, moderator.cookie, 'post', `/notifications/${warn.id}/read`).expect(404);
    expect((await db.db.select().from(schema.moderationActions).where(and(eq(schema.moderationActions.targetId, p.id), eq(schema.moderationActions.action, 'WARN')))).length).toBe(1);
  });
});
