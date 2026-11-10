import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { createBlock, createScreen, type Block, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let counter = 0;
const sent: { phone: string; code: string }[] = [];
const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'get', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const link = (href: string): Block => createBlock('text', { textLayer: { paragraphs: [{ kind: 'p' as const, runs: [{ t: 'Наш сайт', href }] }] } });

describe('P9.2 · TS-06, TS-30, TS-31, TS-32 · новички и защита входа', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;

  const phoneOf = () => `+7901${String(4000000 + ++counter).slice(-7)}`;
  async function loginWith(phone: string): Promise<string> {
    await db.db.delete(schema.otpRequests);
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sent.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    return ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
  }
  async function login(opts: { role?: 'MODERATOR'; ageDays?: number; phone?: string } = {}): Promise<{ cookie: string; id: string; phone: string }> {
    const phone = opts.phone ?? phoneOf();
    const cookie = await loginWith(phone);
    const [u] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    if (opts.role) await db.db.update(schema.users).set({ role: opts.role }).where(eq(schema.users.id, u!.id));
    if (opts.ageDays) await db.db.update(schema.users).set({ createdAt: new Date(Date.now() - opts.ageDays * 86_400_000) }).where(eq(schema.users.id, u!.id));
    return { cookie, id: u!.id, phone };
  }
  async function tryPublish(cookie: string, blocks: Block[] = []) {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Праздничная открытка' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    created.document.screens[0]!.blocks.push(...blocks, createBlock('button'));
    created.document.screens.push(createScreen('Второй'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    return { id: created.id, res: await call(t, cookie, 'post', `/projects/${created.id}/publish`) };
  }
  const codes = (res: request.Response) => ((res.body as { error: { issues?: Array<{ code: string }> } }).error.issues ?? []).map((i) => i.code);
  const statusOf = async (id: string) => (await db.db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0]!.status;
  const block = (moderator: string, userId: string, action: 'BLOCK_USER' | 'RESTORE') =>
    call(t, moderator, 'post', '/admin/actions', { targetType: 'USER', targetId: userId, action, reasonCode: action === 'RESTORE' ? 'MISTAKE' : 'A3', note: 'Проверка' }).expect(201);

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('TS-06 · в первые сутки: третья публикация и ссылка на другой сайт отклонены; через сутки обе проходят', async () => {
    const fresh = await login();
    expect((await tryPublish(fresh.cookie)).res.status).toBe(200);
    expect((await tryPublish(fresh.cookie)).res.status).toBe(200);
    const third = await tryPublish(fresh.cookie);
    expect(third.res.status).toBe(422);
    expect(codes(third.res)).toContain('NEW_ACCOUNT_LIMIT');
    expect(await statusOf(third.id)).toBe('DRAFT');
    const withLink = await tryPublish((await login()).cookie, [link('https://example.org/page')]);
    expect(codes(withLink.res)).toContain('NEW_ACCOUNT_LINK');
    const old = await login({ ageDays: 2 });
    for (let i = 0; i < 3; i++) expect((await tryPublish(old.cookie)).res.status).toBe(200);
    const oldWithLink = await login({ ageDays: 2 });
    expect((await tryPublish(oldWithLink.cookie, [link('https://example.org/page')])).res.status).toBe(200);
  });

  it('TS-06 · видео длиннее 30 секунд в первые сутки отклонено, короткое проходит', async () => {
    const user = await login();
    const mk = async (durationMs: number) => {
      const [m] = await db.db.insert(schema.media).values({ ownerId: user.id, kind: 'VIDEO', mime: 'video/mp4', bytes: 1000, sha256: `sha${++counter}`, durationMs, status: 'READY' }).returning();
      return m!.id;
    };
    const video = (id: string) => { const b = createBlock('shape'); b.style.fills = [{ kind: 'media', media: { source: 'media', id }, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scale: 1 }]; return b; };
    const long = await tryPublish(user.cookie, [video(await mk(45_000))]);
    expect(codes(long.res)).toContain('NEW_ACCOUNT_VIDEO');
    expect((await tryPublish(user.cookie, [video(await mk(20_000))])).res.status).toBe(200);
  });

  it('TS-06 · без подтверждённого номера ссылки на другие сайты запрещены даже у старого аккаунта', async () => {
    const user = await login({ ageDays: 5 });
    await db.db.update(schema.users).set({ phoneE164: null }).where(eq(schema.users.id, user.id));
    const res = await tryPublish(user.cookie, [link('https://example.org/')]);
    expect(codes(res.res)).toContain('PHONE_LINK');
    expect((await tryPublish(user.cookie)).res.status).toBe(200);
  });

  it('TS-31 · блокировка снимает все сборки, закрывает номер и не пускает с ним снова; восстановление всё возвращает', async () => {
    const moderator = await login({ role: 'MODERATOR', ageDays: 3 });
    const victim = await login({ ageDays: 3 });
    const a = await tryPublish(victim.cookie);
    const b = await tryPublish(victim.cookie);
    expect(await statusOf(a.id)).toBe('PUBLISHED');
    await block(moderator.cookie, victim.id, 'BLOCK_USER');
    expect(await statusOf(a.id)).not.toBe('PUBLISHED');
    expect(await statusOf(b.id)).not.toBe('PUBLISHED');
    await call(t, victim.cookie, 'get', '/auth/account').expect(401);
    const again = await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: victim.phone, captchaToken: 'ok' });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('ACCOUNT_BLOCKED');
    await block(moderator.cookie, victim.id, 'RESTORE');
    expect(await statusOf(a.id)).toBe('PUBLISHED');
    await loginWith(victim.phone);
  });

  it('TS-32 · закрытый VK-аккаунт не входит и не создаёт новый; чужой аккаунт с чужим VK не затронут', async () => {
    const moderator = await login({ role: 'MODERATOR', ageDays: 3 });
    const victim = await login({ ageDays: 3 });
    await db.db.insert(schema.authIdentities).values({ userId: victim.id, provider: 'VK', providerUserId: '42' });
    await block(moderator.cookie, victim.id, 'BLOCK_USER');
    const init = await request(t.http()).get(`/${API_PREFIX}/auth/oauth/vk/init`).redirects(0).expect(302);
    const state = new URL(init.headers['location'] as string, 'http://127.0.0.1').searchParams.get('state')!;
    const cb = await request(t.http()).get(`/${API_PREFIX}/auth/oauth/vk/callback?code=dev-code-vk&state=${state}`).redirects(0).expect(302);
    expect(cb.headers['location']).toBe('http://localhost:3110/login?error=blocked');
    expect(cb.headers['set-cookie']).toBeUndefined();
    const same = await db.db.select().from(schema.authIdentities).where(eq(schema.authIdentities.providerUserId, '42'));
    expect(same).toHaveLength(1);
    const log = await db.db.select().from(schema.auditLog);
    expect(log.some((r) => r.action === 'BLOCKED_IDENTITY_DENIED')).toBe(true);
  });

  it('TS-30 · дневной бюджет СМС исчерпан: код не отправляется, человека отправляют к VK и Яндексу', async () => {
    const small = await startTestApp({ db: db.db, otpSender: { sendCode: vi.fn(() => Promise.resolve()) }, captchaVerifier: { verify: () => Promise.resolve(true) } }, { smsDailyBudget: 1 });
    try {
      await db.db.delete(schema.otpRequests);
      await request(small.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: phoneOf(), captchaToken: 'ok' }).expect(200);
      const res = await request(small.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone: phoneOf(), captchaToken: 'ok' }).expect(503);
      expect(res.body.error.code).toBe('SMS_BUDGET_EXCEEDED');
      expect(res.body.error.message).toContain('VK');
    } finally {
      await small.app.close();
    }
  });
});
