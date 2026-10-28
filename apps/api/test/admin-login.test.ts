import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

const ADMIN_ID = '777000111222';

const base32 = (s: string): Buffer => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
/** The code an authenticator shows (RFC 6238, SHA-1, 6 digits, 30 s) for the secret in base32. */
const codeFor = (secret: string, shiftSteps = 0): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + shiftSteps));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
};

describe('AD-01 · вход администратора через VK ID / Яндекс ID с обязательным TOTP', () => {
  let t: TestApp;
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    t = await startTestApp({ db: db.db }, { adminAccounts: [`vk:${ADMIN_ID}`, 'yandex:888000111222'] });
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  const cookiesOf = (res: request.Response): string[] => {
    const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  };
  const pair = (cookies: string[], name: string): string | undefined => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0];

  /** The callback of the provider emulator for a chosen user. */
  async function callback(provider: 'vk' | 'yandex', userId: string, name: string): Promise<request.Response> {
    const init = await request(t.http()).get(`/${API_PREFIX}/auth/oauth/${provider}/init`).redirects(0);
    const state = new URL(init.headers['location'] as string, 'http://127.0.0.1').searchParams.get('state')!;
    const encoded = Buffer.from(JSON.stringify({ userId, displayName: name })).toString('base64url');
    return request(t.http()).get(`/${API_PREFIX}/auth/oauth/${provider}/callback?code=dev-code-${provider}.${encoded}&state=${state}`).redirects(0);
  }
  const post = (url: string, cookie: string | undefined, body: unknown = {}) => {
    const r = request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1');
    return (cookie ? r.set('Cookie', cookie) : r).send(body as object);
  };

  it('AD-01 · аккаунт из ADMIN_ACCOUNTS становится администратором, но сессии до второго фактора нет', async () => {
    const res = await callback('vk', ADMIN_ID, 'Админ');
    expect(res.headers['location']).toBe('http://localhost:3110/login/2fa');
    expect(pair(cookiesOf(res), 'session')).toBeUndefined();
    expect(pair(cookiesOf(res), 'bk_mfa')).toBeDefined();
    const [user] = await db.db.select().from(schema.users).innerJoin(schema.authIdentities, eq(schema.authIdentities.userId, schema.users.id)).where(eq(schema.authIdentities.providerUserId, ADMIN_ID));
    expect(user!.users.role).toBe('ADMIN');
  });

  it('AD-01 · первый вход: секрет и QR, код принимается — сессия, резервные коды один раз; следующий вход спрашивает код', async () => {
    const first = await callback('vk', ADMIN_ID, 'Админ');
    let mfa = pair(cookiesOf(first), 'bk_mfa')!;
    const start = await post('/auth/oauth/mfa/start', mfa).expect(200);
    expect(start.body.mode).toBe('enrol');
    expect(start.body.totpUri).toContain('otpauth://totp/');
    expect(start.body.qrSvg).toContain('<svg');
    mfa = pair(cookiesOf(start), 'bk_mfa')!;
    // Неверный код не создаёт сессию и не сохраняет секрет.
    const wrong = await post('/auth/oauth/mfa/verify', mfa, { code: '000000' }).expect(400);
    expect(wrong.body.error.code).toBe('INVALID_TOTP');
    const [before] = await db.db.select({ s: schema.users.totpSecretEnc }).from(schema.users).innerJoin(schema.authIdentities, eq(schema.authIdentities.userId, schema.users.id)).where(eq(schema.authIdentities.providerUserId, ADMIN_ID));
    expect(before!.s).toBeNull();

    const ok = await post('/auth/oauth/mfa/verify', mfa, { code: codeFor(start.body.secret as string) }).expect(200);
    expect(ok.body.user.role).toBe('ADMIN');
    expect(ok.body.backupCodes).toHaveLength(8);
    const session = pair(cookiesOf(ok), 'session')!;
    expect(session).toBeDefined();
    const me = await request(t.http()).get(`/${API_PREFIX}/auth/me`).set('Cookie', session).expect(200);
    expect(me.body.role).toBe('ADMIN');

    // Второй вход: секрет уже есть — просит код, а не показывает секрет.
    const again = await callback('vk', ADMIN_ID, 'Админ');
    const mfa2 = pair(cookiesOf(again), 'bk_mfa')!;
    const start2 = await post('/auth/oauth/mfa/start', mfa2).expect(200);
    expect(start2.body).toEqual({ mode: 'verify' });
    const backup = (ok.body.backupCodes as string[])[0]!;
    const withBackup = await post('/auth/oauth/mfa/verify', mfa2, { code: backup }).expect(200);
    expect(pair(cookiesOf(withBackup), 'session')).toBeDefined();
    // Резервный код одноразовый.
    const third = await callback('vk', ADMIN_ID, 'Админ');
    await post('/auth/oauth/mfa/verify', pair(cookiesOf(third), 'bk_mfa'), { code: backup }).expect(400);
  });

  it('AD-01 · без метки входа, с чужой или испорченной меткой — отказ; метка не годится как сессия', async () => {
    await post('/auth/oauth/mfa/start', undefined).expect(401);
    await post('/auth/oauth/mfa/verify', 'bk_mfa=abc.def', { code: '123456' }).expect(401);
    const res = await callback('vk', ADMIN_ID, 'Админ');
    const mfa = pair(cookiesOf(res), 'bk_mfa')!;
    await post('/auth/oauth/mfa/verify', `${mfa}x`, { code: '123456' }).expect(401);
    await request(t.http()).get(`/${API_PREFIX}/auth/me`).set('Cookie', mfa.replace('bk_mfa', 'session')).expect(401);
  });

  it('AD-01 · после пяти неверных кодов — 429', async () => {
    const res = await callback('yandex', '888000111222', 'Админ Яндекса');
    const start = await post('/auth/oauth/mfa/start', pair(cookiesOf(res), 'bk_mfa')).expect(200);
    const mfa = pair(cookiesOf(start), 'bk_mfa')!;
    for (let i = 0; i < 5; i++) await post('/auth/oauth/mfa/verify', mfa, { code: '000000' }).expect(400);
    const blocked = await post('/auth/oauth/mfa/verify', mfa, { code: codeFor(start.body.secret as string) }).expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('AD-01 · обычный пользователь входит без второго фактора; тот же номер у другого провайдера — другой человек', async () => {
    const user = await callback('vk', '555000111', 'Обычный');
    expect(pair(cookiesOf(user), 'session')).toBeDefined();
    expect(user.headers['location']).toBe('http://localhost:3110/onboarding');
    // Номер администратора у Яндекса — не администратор.
    const other = await callback('yandex', ADMIN_ID, 'Другой');
    expect(pair(cookiesOf(other), 'session')).toBeDefined();
    expect(pair(cookiesOf(other), 'bk_mfa')).toBeUndefined();
  });

  it('AD-01 · журнал аудита: назначение по аккаунту, настройка и вход со вторым фактором', async () => {
    const rows = await db.db.select({ action: schema.auditLog.action }).from(schema.auditLog);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['ROLE_ADMIN_BY_ACCOUNT', 'TOTP_CONFIRMED', 'TOTP_LOGIN', 'TOTP_LOGIN_BACKUP', 'TOTP_FAILED']));
  });
});
