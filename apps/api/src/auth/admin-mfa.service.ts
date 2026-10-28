import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { type Db, schema } from '@blokum/db';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';
import { AuditLogService } from './audit-log.service.js';
import type { RequestUser } from './session.service.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';

/** AD-01 · name of the cookie that carries the half-finished sign-in of an administrator or moderator. */
export const MFA_COOKIE = 'bk_mfa';
const PENDING_TTL_MS = 10 * 60 * 1000;
const TRIES = 5;
const TRIES_WINDOW_MS = 10 * 60 * 1000;

interface Pending {
  /** The user. */
  u: string;
  /** Expiry, ms. */
  e: number;
  /** A secret being enrolled (encrypted); absent when the user already has the second factor. */
  s?: string;
}

export interface MfaStart {
  mode: 'verify' | 'enrol';
  /** Only when enrolling: the address of the code for an authenticator, its picture, and the secret for typing in. */
  totpUri?: string;
  qrSvg?: string;
  secret?: string;
  /** A new pending sign-in when the secret was just made (the cookie is renewed). */
  pending: string;
}

/**
 * AD-01 · the second factor of the sign-in through VK ID / Яндекс ID. An administrator or a moderator gets no session from
 * the provider alone: the callback leaves a signed pending sign-in (cookie, ten minutes) and the person enters the code of the
 * authenticator. The first time there is no secret yet: it is made here, shown once, and kept only after the first right code
 * (so an abandoned setup leaves nothing locked).
 */
@Injectable()
export class AdminMfaService {
  private readonly tries = new Map<string, { n: number; since: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly totp: TotpService,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
  ) {}

  required(user: Pick<RequestUser, 'role'>): boolean {
    return user.role === 'ADMIN' || user.role === 'MODERATOR';
  }

  private key(): Buffer {
    return createHmac('sha256', Buffer.from(this.config.totpSecretKey, 'hex')).update('admin-mfa-pending').digest();
  }

  private seal(p: Pending): string {
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    return `${body}.${createHmac('sha256', this.key()).update(body).digest('base64url')}`;
  }

  private open(token: string | undefined): Pending {
    const bad = () => new UnauthorizedException({ error: { code: 'MFA_EXPIRED', message: 'Вход устарел. Войдите через VK ID или Яндекс ID ещё раз.' } });
    if (!token) throw bad();
    const [body, sig] = token.split('.');
    if (!body || !sig) throw bad();
    const expected = createHmac('sha256', this.key()).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();
    let p: Pending;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Pending;
    } catch {
      throw bad();
    }
    if (typeof p.u !== 'string' || typeof p.e !== 'number' || p.e < Date.now()) throw bad();
    return p;
  }

  /** The pending sign-in of a user who has passed the provider. */
  begin(userId: string): string {
    return this.seal({ u: userId, e: Date.now() + PENDING_TTL_MS });
  }

  async start(token: string | undefined): Promise<MfaStart> {
    const p = this.open(token);
    const [row] = await this.db.select({ totpSecretEnc: schema.users.totpSecretEnc, displayName: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, p.u));
    if (!row) throw new UnauthorizedException({ error: { code: 'MFA_EXPIRED', message: 'Вход устарел. Войдите ещё раз.' } });
    if (row.totpSecretEnc) return { mode: 'verify', pending: this.seal({ u: p.u, e: p.e }) };
    const enc = p.s ?? this.totp.encryptSecret(this.totp.generateSecret());
    const totpUri = this.totp.totpUri(enc, row.displayName || p.u);
    const secret = new URL(totpUri).searchParams.get('secret') ?? '';
    return { mode: 'enrol', totpUri, qrSvg: await QRCode.toString(totpUri, { type: 'svg', margin: 1 }), secret, pending: this.seal({ u: p.u, e: p.e, s: enc }) };
  }

  private spend(userId: string): void {
    const now = Date.now();
    const t = this.tries.get(userId);
    const fresh = t && now - t.since < TRIES_WINDOW_MS ? t : { n: 0, since: now };
    if (fresh.n >= TRIES) throw new HttpException({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Слишком много попыток. Подождите несколько минут.' } }, 429);
    this.tries.set(userId, { n: fresh.n + 1, since: fresh.since });
  }

  /** The code of the authenticator (or a backup code) is right: the session begins. On the first time the secret is kept and backup codes are given once. */
  async verify(token: string | undefined, rawCode: unknown, ip: string, ua: string): Promise<{ token: string; user: RequestUser; backupCodes?: string[] }> {
    const p = this.open(token);
    const code = typeof rawCode === 'string' ? rawCode.replace(/\s/g, '') : '';
    if (code === '') throw new BadRequestException({ error: { code: 'INVALID_TOTP', message: 'Введите код из приложения.' } });
    this.spend(p.u);
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.id, p.u));
    if (!row || row.status !== 'ACTIVE' || !this.required({ role: row.role })) throw new UnauthorizedException({ error: { code: 'MFA_EXPIRED', message: 'Вход устарел. Войдите ещё раз.' } });

    let backupCodes: string[] | undefined;
    let usedBackup = false;
    if (row.totpSecretEnc) {
      let ok = this.totp.verifyTotpCode(row.totpSecretEnc, code);
      if (!ok) ok = usedBackup = await this.totp.verifyAndConsumeBackupCode(row.id, code);
      if (!ok) {
        await this.audit.log({ actorId: row.id, action: 'TOTP_FAILED', targetType: 'user', targetId: row.id, ip });
        throw new BadRequestException({ error: { code: 'INVALID_TOTP', message: 'Неверный код. Проверьте время на телефоне и попробуйте ещё раз.' } });
      }
    } else {
      if (!p.s) throw new BadRequestException({ error: { code: 'TOTP_NOT_SETUP', message: 'Сначала настройте приложение-аутентификатор.' } });
      if (!this.totp.verifyTotpCode(p.s, code)) {
        await this.audit.log({ actorId: row.id, action: 'TOTP_FAILED', targetType: 'user', targetId: row.id, ip });
        throw new BadRequestException({ error: { code: 'INVALID_TOTP', message: 'Неверный код. Проверьте время на телефоне и попробуйте ещё раз.' } });
      }
      await this.db.update(schema.users).set({ totpSecretEnc: p.s }).where(eq(schema.users.id, row.id));
      const pairs = this.totp.generateBackupCodes();
      await this.totp.storeBackupCodes(row.id, pairs.map((x) => x.hash));
      backupCodes = pairs.map((x) => x.code);
      await this.audit.log({ actorId: row.id, action: 'TOTP_CONFIRMED', targetType: 'user', targetId: row.id, ip });
    }
    this.tries.delete(p.u);
    await this.audit.log({ actorId: row.id, action: usedBackup ? 'TOTP_LOGIN_BACKUP' : 'TOTP_LOGIN', targetType: 'user', targetId: row.id, ip });
    const session = await this.sessions.create(row.id, { ip, ua });
    return { token: session, user: { id: row.id, role: row.role, status: row.status, displayName: row.displayName, phoneE164: row.phoneE164 }, ...(backupCodes ? { backupCodes } : {}) };
  }
}
