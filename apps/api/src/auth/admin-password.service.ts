import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException, HttpException, Inject, Injectable, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createId as generateId } from '@blokum/schema';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';
import { AdminMfaService } from './admin-mfa.service.js';
import { AuditLogService } from './audit-log.service.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 64;
/** The shortest password; the longest keeps the hashing cheap for an attacker who sends megabytes. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;
/** Wrong passwords in a row before the door is shut; the first shutting is 15 minutes, every next one twice as long, a day at most. */
export const FAILS_BEFORE_LOCK = 5;
const LOCK_FIRST_MS = 15 * 60 * 1000;
const LOCK_MAX_MS = 24 * 60 * 60 * 1000;
/** Misses of one address, and of one unknown login (a known one has its own lock, and the answer must not say which is which). */
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP = 20;
const PER_LOGIN = FAILS_BEFORE_LOCK;

const TOO_MANY = { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Слишком много неудачных попыток входа. Подождите и попробуйте позже.' } };
const WRONG = { error: { code: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль.' } };

export const normalizeLogin = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** What a good password is, in Russian; `null` when it is fine. */
export function passwordProblem(password: unknown, login = ''): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Пароль должен быть не короче ${PASSWORD_MIN} знаков.`;
  if (password.length > PASSWORD_MAX) return `Пароль не длиннее ${PASSWORD_MAX} знаков.`;
  if (login !== '' && password.toLowerCase().includes(login)) return 'Пароль не должен содержать логин.';
  if (new Set(password).size < 5) return 'В пароле слишком мало разных знаков.';
  if (!/\p{L}/u.test(password) || !/[\d\p{P}\p{S}]/u.test(password)) return 'Добавьте в пароль и буквы, и цифры или знаки.';
  return null;
}

/**
 * AD-01 · sign-in of an administrator or a moderator by login and password. The password only opens the second step: the answer
 * is the same pending sign-in that follows a provider (cookie, ten minutes), and the session begins after the code of the
 * authenticator. Guessing is slowed three ways: the door of an account shuts after five wrong passwords (15 minutes, then twice
 * as long each time, a day at most), one address and one login (known or not) are limited in a window, and every miss is audited.
 */
@Injectable()
export class AdminPasswordService implements OnModuleInit {
  private readonly byIp = new Map<string, { n: number; since: number }>();
  private readonly byLogin = new Map<string, { n: number; since: number }>();
  /** A hash to compare against when the login is unknown, so a miss takes as long as a wrong password. */
  private dummy: Promise<string> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly mfa: AdminMfaService,
    private readonly audit: AuditLogService,
  ) {}

  /** The first administrator from the server environment: made once, never overwritten (the password is changed in the admin afterwards). */
  async onModuleInit(): Promise<void> {
    const boot = this.config.adminBootstrap;
    if (!boot) return;
    const problem = passwordProblem(boot.password, boot.login);
    if (boot.login.length < 3 || problem) {
      console.error(`AD-01: пароль первого администратора из окружения не принят: ${problem ?? 'логин короче 3 знаков'}`);
      return;
    }
    // Only the very first start: once an administrator has a password (or it was moved to another account) nothing is made again.
    const [exists] = await this.db.select({ userId: schema.adminCredentials.userId }).from(schema.adminCredentials).limit(1);
    if (exists) return;
    const userId = generateId();
    await this.db.insert(schema.users).values({ id: userId, displayName: boot.login, role: 'ADMIN', status: 'ACTIVE' });
    await this.db.insert(schema.adminCredentials).values({ userId, login: boot.login, passwordHash: await hashPassword(boot.password) });
    await this.audit.log({ actorId: userId, action: 'ADMIN_PASSWORD_CREATED', targetType: 'user', targetId: userId });
  }

  /** The window of one address or one login is spent: no more tries until it passes. Only misses are counted, a right password is never held up. */
  private assertRoom(map: Map<string, { n: number; since: number }>, key: string, limit: number): void {
    const t = map.get(key);
    if (t && Date.now() - t.since < WINDOW_MS && t.n >= limit) throw new HttpException(TOO_MANY, 429);
  }

  private spend(map: Map<string, { n: number; since: number }>, key: string): void {
    const now = Date.now();
    const t = map.get(key);
    map.set(key, t && now - t.since < WINDOW_MS ? { n: t.n + 1, since: t.since } : { n: 1, since: now });
    if (map.size > 5000) for (const [k, v] of map) if (now - v.since >= WINDOW_MS) map.delete(k);
  }

  /** Login and password are right: the pending sign-in (second step) is returned; otherwise a Russian error that does not say which part was wrong. */
  async login(rawLogin: unknown, rawPassword: unknown, ip: string): Promise<{ pending: string }> {
    const login = normalizeLogin(rawLogin);
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    if (login === '' || password === '' || login.length > 100 || password.length > PASSWORD_MAX) throw new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'Введите логин и пароль.' } });
    const who = ip || 'unknown';
    this.assertRoom(this.byIp, who, PER_IP);

    const [row] = await this.db
      .select({ cred: schema.adminCredentials, role: schema.users.role, status: schema.users.status })
      .from(schema.adminCredentials)
      .innerJoin(schema.users, eq(schema.adminCredentials.userId, schema.users.id))
      .where(eq(schema.adminCredentials.login, login));
    // A known account is guarded by its own lock; the window of a login is for the unknown ones.
    if (!row) this.assertRoom(this.byLogin, login, PER_LOGIN);
    const now = Date.now();
    if (row?.cred.lockedUntil && row.cred.lockedUntil.getTime() > now) {
      await this.audit.log({ actorId: row.cred.userId, action: 'ADMIN_LOGIN_LOCKED', targetType: 'user', targetId: row.cred.userId, ip });
      throw new HttpException(TOO_MANY, 429);
    }
    this.dummy ??= hashPassword(randomBytes(16).toString('hex'));
    const ok = await checkPassword(password, row ? row.cred.passwordHash : await this.dummy);
    if (!row || !ok || row.status !== 'ACTIVE' || (row.role !== 'ADMIN' && row.role !== 'MODERATOR')) {
      this.spend(this.byIp, who);
      if (row) await this.fail(row.cred, ip);
      else this.spend(this.byLogin, login);
      throw new UnauthorizedException(WRONG);
    }
    await this.db.update(schema.adminCredentials).set({ failedCount: 0, lockedUntil: null, lockLevel: 0 }).where(eq(schema.adminCredentials.userId, row.cred.userId));
    await this.audit.log({ actorId: row.cred.userId, action: 'ADMIN_PASSWORD_OK', targetType: 'user', targetId: row.cred.userId, ip });
    return { pending: this.mfa.begin(row.cred.userId) };
  }

  private async fail(cred: typeof schema.adminCredentials.$inferSelect, ip: string): Promise<void> {
    const failed = cred.failedCount + 1;
    const shut = failed >= FAILS_BEFORE_LOCK;
    const level = shut ? cred.lockLevel + 1 : cred.lockLevel;
    const lockedUntil = shut ? new Date(Date.now() + Math.min(LOCK_MAX_MS, LOCK_FIRST_MS * 2 ** (level - 1))) : cred.lockedUntil;
    await this.db.update(schema.adminCredentials).set({ failedCount: shut ? 0 : failed, lockLevel: level, lockedUntil }).where(eq(schema.adminCredentials.userId, cred.userId));
    await this.audit.log({ actorId: cred.userId, action: shut ? 'ADMIN_LOGIN_LOCK_SET' : 'ADMIN_PASSWORD_FAILED', targetType: 'user', targetId: cred.userId, ip });
  }

  /** A signed-in administrator changes the password: the old one is asked again; all other sessions stay (the person decides). */
  async change(userId: string, oldPassword: unknown, newPassword: unknown, ip: string): Promise<void> {
    const [cred] = await this.db.select().from(schema.adminCredentials).where(eq(schema.adminCredentials.userId, userId));
    if (!cred) throw new BadRequestException({ error: { code: 'NO_PASSWORD_LOGIN', message: 'У этого аккаунта нет входа по паролю.' } });
    this.assertRoom(this.byIp, `change:${userId}`, FAILS_BEFORE_LOCK);
    if (typeof oldPassword !== 'string' || !(await checkPassword(oldPassword, cred.passwordHash))) {
      this.spend(this.byIp, `change:${userId}`);
      await this.audit.log({ actorId: userId, action: 'ADMIN_PASSWORD_CHANGE_FAILED', targetType: 'user', targetId: userId, ip });
      throw new BadRequestException({ error: { code: 'INVALID_CREDENTIALS', message: 'Текущий пароль указан неверно.' } });
    }
    const problem = passwordProblem(newPassword, cred.login);
    if (problem) throw new BadRequestException({ error: { code: 'WEAK_PASSWORD', message: problem } });
    if (newPassword === oldPassword) throw new BadRequestException({ error: { code: 'WEAK_PASSWORD', message: 'Новый пароль должен отличаться от текущего.' } });
    await this.db.update(schema.adminCredentials).set({ passwordHash: await hashPassword(newPassword as string), passwordChangedAt: new Date(), failedCount: 0, lockedUntil: null, lockLevel: 0 }).where(eq(schema.adminCredentials.userId, userId));
    await this.audit.log({ actorId: userId, action: 'ADMIN_PASSWORD_CHANGED', targetType: 'user', targetId: userId, ip });
  }
}
