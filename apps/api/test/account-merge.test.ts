import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import { BlockedIdentitiesService } from '../src/admin/blocked-identities.service.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

type Provider = 'vk' | 'yandex';

/** A-06 · ADR-117 · привязка второго способа входа и объединение аккаунтов одного человека (настоящая база, эмулятор входа). */
describe('A-06 · способы входа и объединение аккаунтов', () => {
  let db: TestDb;
  let t: TestApp;
  const http = () => request(t.http());
  const payload = (id: string, name: string) => Buffer.from(JSON.stringify({ userId: id, displayName: name })).toString('base64url');
  const stateOf = (url: string) => new URL(url, 'http://127.0.0.1').searchParams.get('state')!;

  async function loginAs(provider: Provider, id: string, name = `Человек ${id}`): Promise<{ cookie: string; userId: string }> {
    const init = await http().get(`/${API_PREFIX}/auth/oauth/${provider}/init`).redirects(0);
    const cb = await http().get(`/${API_PREFIX}/auth/oauth/${provider}/callback?code=dev-code-${provider}.${payload(id, name)}&state=${stateOf(init.headers['location'] as string)}`).redirects(0).expect(302);
    const cookie = (cb.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const me = await http().get(`/${API_PREFIX}/auth/me`).set('Cookie', cookie).expect(200);
    return { cookie, userId: (me.body as { id: string }).id };
  }

  /** Binding the way a person does it: the button in the account → the provider → back to the account page. */
  async function link(cookie: string, provider: Provider, id: string): Promise<{ location: string; setCookie: unknown }> {
    const started = await http().post(`/${API_PREFIX}/auth/account/identities/${provider}/link`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({}).expect(200);
    const url = (started.body as { url: string }).url;
    expect(url).toContain(`/dev/oauth/${provider}/authorize`);
    const cb = await http().get(`/${API_PREFIX}/auth/oauth/${provider}/callback?code=dev-code-${provider}.${payload(id, 'Кто угодно')}&state=${stateOf(url)}`).redirects(0).expect(302);
    return { location: cb.headers['location'] as string, setCookie: cb.headers['set-cookie'] };
  }
  const identities = async (cookie: string) => ((await http().get(`/${API_PREFIX}/auth/account/identities`).set('Cookie', cookie).expect(200)).body as { identities: Array<{ provider: string }> }).identities.map((i) => i.provider);
  const tokenOf = (location: string) => new URL(location).searchParams.get('merge')!;

  beforeAll(async () => {
    db = await createTestDb();
    t = await startTestApp({ db: db.db });
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('A-06 · свободный Яндекс ID привязывается к аккаунту ВК: вход через любой из них — в тот же аккаунт; сеанс не меняется', async () => {
    const a = await loginAs('vk', '810001');
    const r = await link(a.cookie, 'yandex', '910001');
    expect(r.location).toBe('http://localhost:3110/account?linked=yandex');
    expect(r.setCookie).toBeUndefined();
    expect(await identities(a.cookie)).toEqual(['vk', 'yandex']);
    expect((await loginAs('yandex', '910001')).userId).toBe(a.userId);
    // Привязать ещё раз тот же вход — ничего не меняется.
    expect((await link(a.cookie, 'yandex', '910001')).location).toBe('http://localhost:3110/account?linked=yandex');
    // Другой Яндекс ID при уже привязанном — «занято»: сначала отвязать.
    expect((await link(a.cookie, 'yandex', '910002')).location).toBe('http://localhost:3110/account?link_error=taken');
  });

  it('A-06 · отвязать можно лишний способ входа, последний — нельзя', async () => {
    const a = await loginAs('vk', '810002');
    await link(a.cookie, 'yandex', '910003');
    await http().delete(`/${API_PREFIX}/auth/account/identities/yandex`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').expect(200);
    expect(await identities(a.cookie)).toEqual(['vk']);
    const last = await http().delete(`/${API_PREFIX}/auth/account/identities/vk`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').expect(400);
    expect((last.body as { error: { message: string } }).error.message).toBe('Нельзя отвязать последний способ входа');
    await http().delete(`/${API_PREFIX}/auth/account/identities/yandex`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').expect(400);
    await http().post(`/${API_PREFIX}/auth/account/identities/mail/link`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').send({}).expect(400);
    await http().post(`/${API_PREFIX}/auth/account/identities/vk/link`).set('X-Blokum-CSRF', '1').send({}).expect(401);
  });

  it('A-06 · у Яндекс ID уже свой аккаунт: предложение показывает, что в нём, и после подтверждения всё переходит, второй аккаунт удаляется', async () => {
    const a = await loginAs('vk', '810003', 'Олег из ВК');
    const b = await loginAs('yandex', '910004', 'Олег из Яндекса');
    expect(b.userId).not.toBe(a.userId);
    // У второго аккаунта: две сборки (одна удалена), тема, подписка «Автор», заказ, расход за месяц, привязка ВКонтакте для сообщений.
    const now = new Date();
    await db.db.insert(schema.projects).values([
      { ownerId: b.userId, title: 'Квиз из Яндекса', slug: `ya-${Date.now()}` },
      { ownerId: b.userId, title: 'Удалённая', slug: `ya-del-${Date.now()}`, deletedAt: now },
    ]);
    await db.db.insert(schema.themes).values({ ownerId: b.userId, name: 'Тема из Яндекса', tokens: {} });
    await db.db.insert(schema.subscriptions).values({ userId: b.userId, planCode: 'AUTHOR', period: 'MONTH', status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 20 * 86_400_000) });
    await db.db.insert(schema.orders).values({ userId: b.userId, kind: 'SUBSCRIPTION', item: { kind: 'SUBSCRIPTION', planCode: 'AUTHOR', period: 'MONTH' }, amountKop: 19900, provider: 'yookassa', providerPaymentId: `p-${Date.now()}`, status: 'PAID', paidAt: now });
    const month = now.toISOString().slice(0, 7);
    await db.db.insert(schema.usageMonthly).values([
      { userId: a.userId, month, completions: 4, storageBytes: 100 },
      { userId: b.userId, month, completions: 6, storageBytes: 50 },
    ]);
    await db.db.insert(schema.vkLinks).values({ userId: b.userId, peerId: '555001' });

    const r = await link(a.cookie, 'yandex', '910004');
    expect(r.location).toMatch(/^http:\/\/localhost:3110\/account\?merge=[0-9a-f]{48}$/);
    const token = tokenOf(r.location);
    // Чужому человеку предложение не показывается.
    const stranger = await loginAs('vk', '810099');
    await http().get(`/${API_PREFIX}/auth/account/merge/${token}`).set('Cookie', stranger.cookie).expect(404);
    const preview = await http().get(`/${API_PREFIX}/auth/account/merge/${token}`).set('Cookie', a.cookie).expect(200);
    expect(preview.body).toMatchObject({ provider: 'yandex', other: { displayName: 'Олег из Яндекса', projects: 1, themes: 1, plan: 'Автор' } });

    await http().post(`/${API_PREFIX}/auth/account/merge`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').send({ token }).expect(200);
    expect(await db.db.select().from(schema.users).where(eq(schema.users.id, b.userId))).toHaveLength(0);
    expect((await db.db.select().from(schema.projects).where(eq(schema.projects.ownerId, a.userId))).map((p) => p.title).sort()).toEqual(['Квиз из Яндекса', 'Удалённая']);
    expect(await db.db.select().from(schema.themes).where(eq(schema.themes.ownerId, a.userId))).toHaveLength(1);
    expect(await db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, a.userId))).toHaveLength(1);
    expect(await db.db.select().from(schema.orders).where(eq(schema.orders.userId, a.userId))).toHaveLength(1);
    const [usage] = await db.db.select().from(schema.usageMonthly).where(eq(schema.usageMonthly.userId, a.userId));
    expect(usage).toMatchObject({ completions: 10, storageBytes: 150 });
    expect(await db.db.select().from(schema.vkLinks).where(eq(schema.vkLinks.userId, a.userId))).toHaveLength(1);
    expect(await identities(a.cookie)).toEqual(['vk', 'yandex']);
    // Вход через Яндекс ID ведёт теперь в объединённый аккаунт; старый сеанс второго аккаунта больше не действует.
    expect((await loginAs('yandex', '910004')).userId).toBe(a.userId);
    await http().get(`/${API_PREFIX}/auth/me`).set('Cookie', b.cookie).expect(401);
    // Предложение одноразовое.
    await http().post(`/${API_PREFIX}/auth/account/merge`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').send({ token }).expect(404);
    const log = await db.db.select({ action: schema.auditLog.action, meta: schema.auditLog.meta }).from(schema.auditLog).where(eq(schema.auditLog.targetId, a.userId));
    expect(log.find((l) => l.action === 'ACCOUNTS_MERGED')?.meta).toMatchObject({ from: b.userId, provider: 'yandex' });
  });

  it('A-06 · служебный и находящийся под проверкой аккаунт не присоединяется; испорченное предложение — 404', async () => {
    const a = await loginAs('vk', '810004');
    const mod = await loginAs('yandex', '910005');
    await db.db.update(schema.users).set({ role: 'MODERATOR' }).where(eq(schema.users.id, mod.userId));
    const r1 = await link(a.cookie, 'yandex', '910005');
    const refused = await http().get(`/${API_PREFIX}/auth/account/merge/${tokenOf(r1.location)}`).set('Cookie', a.cookie).expect(409);
    expect((refused.body as { error: { message: string } }).error.message).toContain('служебный');
    await http().post(`/${API_PREFIX}/auth/account/merge`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').send({ token: tokenOf(r1.location) }).expect(409);
    expect(await db.db.select().from(schema.users).where(eq(schema.users.id, mod.userId))).toHaveLength(1);

    const held = await loginAs('yandex', '910006');
    await db.db.update(schema.users).set({ legalHold: true }).where(eq(schema.users.id, held.userId));
    const a2 = await loginAs('vk', '810005');
    const r2 = await link(a2.cookie, 'yandex', '910006');
    expect(((await http().get(`/${API_PREFIX}/auth/account/merge/${tokenOf(r2.location)}`).set('Cookie', a2.cookie).expect(409)).body as { error: { message: string } }).error.message).toContain('проверка');

    await http().get(`/${API_PREFIX}/auth/account/merge/not-a-token`).set('Cookie', a.cookie).expect(404);
    await http().post(`/${API_PREFIX}/auth/account/merge`).set('Cookie', a.cookie).set('X-Blokum-CSRF', '1').send({ token: 'f'.repeat(48) }).expect(404);
  });

  it('A-06 · TS-32 · вход заблокированного человека не привязывается к другому аккаунту', async () => {
    const banned = await loginAs('yandex', '910007');
    await t.app.get(BlockedIdentitiesService).block(db.db, banned.userId);
    const a = await loginAs('vk', '810006');
    const r = await link(a.cookie, 'yandex', '910007');
    expect(r.location).toBe('http://localhost:3110/account?link_error=blocked');
    expect(await identities(a.cookie)).toEqual(['vk']);
  });
});
