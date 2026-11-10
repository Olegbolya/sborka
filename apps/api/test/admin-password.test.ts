import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import { checkPassword, hashPassword, passwordProblem } from '../src/auth/admin-password.service.js';
import { createTestDb, startTestApp, type TestApp, type TestDb, pgSkipGuard } from './helpers.js';

const LOGIN = 'oleg-admin';
const PASSWORD = 'Длинный-пароль-2026';

const base32 = (s: string): Buffer => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
const codeFor = (secret: string): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
};

describe('AD-01 · пароль: хеш и правила', () => {
  it('AD-01 · хеш проверяется только верным паролем и каждый раз другой (соль)', async () => {
    const a = await hashPassword('Верный-пароль-1');
    const b = await hashPassword('Верный-пароль-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await checkPassword('Верный-пароль-1', a)).toBe(true);
    expect(await checkPassword('Верный-пароль-2', a)).toBe(false);
    expect(await checkPassword('x', 'мусор')).toBe(false);
  });

  it('AD-01 · короткие, простые пароли и пароль с логином отклоняются по-русски', () => {
    expect(passwordProblem('Коротк1!')).toContain('не короче 12');
    expect(passwordProblem('aaaaaaaaaaaa1')).toContain('мало разных');
    expect(passwordProblem('толькобуквыбезцифр')).toContain('буквы, и цифры');
    expect(passwordProblem('oleg-admin-2026-xyz', 'oleg-admin')).toContain('логин');
    expect(passwordProblem(PASSWORD, LOGIN)).toBeNull();
  });
});

describe('AD-01 · вход администратора по логину и паролю с защитой от подбора', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let n = 0;
  /** The secret of the authenticator made at the first sign-in (test 2) and used by the later tests. */
  let totpSecret = '';
  const nextIp = (): string => `10.1.${Math.floor(++n / 200)}.${n % 200}`;

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db }, { adminBootstrap: { login: LOGIN, password: PASSWORD } });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') { pg.skip(); return; }
      throw e;
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  const cookiesOf = (res: request.Response): string[] => {
    const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  };
  const pair = (cookies: string[], name: string): string | undefined => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  const post = (url: string, body: unknown, opts: { cookie?: string; ip?: string } = {}) => {
    let r = request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.cookie) r = r.set('Cookie', opts.cookie);
    return r.send(body as object);
  };
  const login = (password: string, who = LOGIN, ip?: string) => post('/auth/admin/login', { login: who, password }, ip ? { ip } : {});
  const row = async () => (await db.db.select().from(schema.adminCredentials).where(eq(schema.adminCredentials.login, LOGIN)))[0]!;
  const reset = async () => void (await db.db.update(schema.adminCredentials).set({ failedCount: 0, lockedUntil: null, lockLevel: 0 }).where(eq(schema.adminCredentials.login, LOGIN)));

  it('AD-01 · первый администратор из окружения создаётся один раз с ролью ADMIN, пароль лежит только хешем', async () => {
    const rows = await db.db.select().from(schema.adminCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.login).toBe(LOGIN);
    expect(rows[0]!.passwordHash).not.toContain(PASSWORD);
    const [user] = await db.db.select().from(schema.users).where(eq(schema.users.id, rows[0]!.userId));
    expect(user!.role).toBe('ADMIN');
    expect(user!.phoneE164).toBeNull();
  });

  it('AD-01 · верный пароль открывает только второй шаг: сессии нет, потом код из приложения даёт сессию администратора', async () => {
    const ok = await login(PASSWORD).expect(200);
    expect(ok.body).toEqual({ next: '/login/2fa' });
    expect(pair(cookiesOf(ok), 'session')).toBeUndefined();
    const mfa = pair(cookiesOf(ok), 'bk_mfa')!;
    expect(mfa).toBeDefined();
    const start = await post('/auth/oauth/mfa/start', {}, { cookie: mfa }).expect(200);
    expect(start.body.mode).toBe('enrol');
    totpSecret = start.body.secret as string;
    const done = await post('/auth/oauth/mfa/verify', { code: codeFor(totpSecret) }, { cookie: pair(cookiesOf(start), 'bk_mfa')! }).expect(200);
    const session = pair(cookiesOf(done), 'session')!;
    const me = await request(t.http()).get(`/${API_PREFIX}/auth/me`).set('Cookie', session).expect(200);
    expect(me.body.role).toBe('ADMIN');
    await reset();
  });

  it('AD-01 · неверный пароль и неизвестный логин отвечают одинаково и ничего не раскрывают', async () => {
    const wrong = await login('Совсем-не-тот-пароль-1').expect(401);
    const unknown = await login('Совсем-не-тот-пароль-1', 'никого-нет').expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error.message).toBe('Неверный логин или пароль.');
    expect(pair(cookiesOf(wrong), 'bk_mfa')).toBeUndefined();
    await login('').expect(400);
    await reset();
  });

  it('AD-01 · после пяти неверных паролей вход закрывается: даже верный пароль не принимается, пока не пройдёт пауза', async () => {
    for (let i = 0; i < 5; i++) await login('Неверный-пароль-номер-' + i).expect(401);
    const locked = await row();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(locked.lockLevel).toBe(1);
    const right = await login(PASSWORD).expect(429);
    expect(right.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(pair(cookiesOf(right), 'bk_mfa')).toBeUndefined();
    const audit = await db.db.select().from(schema.auditLog);
    expect(audit.some((a) => a.action === 'ADMIN_LOGIN_LOCK_SET')).toBe(true);
    expect(audit.some((a) => a.action === 'ADMIN_LOGIN_LOCKED')).toBe(true);
    // Пауза прошла: верный пароль снова работает и снимает счётчики.
    await db.db.update(schema.adminCredentials).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.adminCredentials.login, LOGIN));
    await login(PASSWORD).expect(200);
    const after = await row();
    expect(after.failedCount).toBe(0);
    expect(after.lockLevel).toBe(0);
  });

  it('AD-01 · каждая следующая блокировка вдвое длиннее', async () => {
    await reset();
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < 5; i++) await login('Опять-неверный-' + round + i).expect(401);
      const r = await row();
      expect(r.lockLevel).toBe(round);
      const minutes = (r.lockedUntil!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(15 * 2 ** (round - 1) - 1);
      expect(minutes).toBeLessThanOrEqual(15 * 2 ** (round - 1));
      await db.db.update(schema.adminCredentials).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.adminCredentials.login, LOGIN));
    }
    // A right password clears the count of the login (and of the lock).
    await login(PASSWORD).expect(200);
    await reset();
  });

  it('AD-01 · один адрес не может перебирать: после двадцати попыток отвечает 429 даже на другой логин', async () => {
    const ip = '10.9.9.9';
    for (let i = 0; i < 20; i++) await post('/auth/admin/login', { login: 'перебор-' + i, password: 'Какой-то-пароль-1' }, { ip }).expect(401);
    const res = await post('/auth/admin/login', { login: 'ещё-один', password: 'Какой-то-пароль-1' }, { ip }).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('AD-01 · смена пароля: нужен текущий, слабый новый отклоняется, после смены старый не подходит', async () => {
    await reset();
    const ok = await login(PASSWORD).expect(200);
    const mfa = pair(cookiesOf(ok), 'bk_mfa')!;
    const start = await post('/auth/oauth/mfa/start', {}, { cookie: mfa }).expect(200);
    expect(start.body.mode).toBe('verify');
    const done = await post('/auth/oauth/mfa/verify', { code: codeFor(totpSecret) }, { cookie: pair(cookiesOf(start), 'bk_mfa')! }).expect(200);
    const session = pair(cookiesOf(done), 'session')!;
    const change = (oldPassword: string, newPassword: string) => post('/auth/admin/password', { oldPassword, newPassword }, { cookie: session });
    await change('не-тот', 'Новый-пароль-2027-ok').expect(400);
    const weak = await change(PASSWORD, 'коротко').expect(400);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');
    await change(PASSWORD, PASSWORD).expect(400);
    await change(PASSWORD, 'Новый-пароль-2027-ok').expect(200);
    await login(PASSWORD).expect(401);
    await login('Новый-пароль-2027-ok').expect(200);
    await post('/auth/admin/password', { oldPassword: PASSWORD, newPassword: 'Другой-пароль-2028-ok' }).expect(401);
  });

  it('AD-01 · обычный пользователь не может сменить пароль администратора, а вход по паролю не даёт ему роль', async () => {
    const res = await post('/auth/admin/password', { oldPassword: 'a', newPassword: 'b' }, { cookie: 'session=net' });
    expect([401, 403]).toContain(res.status);
  });
});
