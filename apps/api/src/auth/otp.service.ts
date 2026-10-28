import { createHash, createHmac, randomInt } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { FeatureFlagsService } from '../admin/feature-flags.service.js';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, CAPTCHA_VERIFIER, DB, OTP_SENDER } from '../tokens.js';
import type { CaptchaVerifier } from './captcha.js';
import type { OtpSender } from './otp-sender.js';
import { type RequestUser, SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';
import { AuditLogService } from './audit-log.service.js';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const PHONE_HOUR_LIMIT = 3;
const PHONE_DAY_LIMIT = 10;
const IP_HOUR_LIMIT = 5;

/** A-01, TS-30: normalises raw phone input to E.164 (+7XXXXXXXXXX) for Russian numbers. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  let normalized: string;
  if (digits.length === 11 && digits.startsWith('8')) {
    normalized = '7' + digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith('7')) {
    normalized = digits;
  } else if (digits.length === 10) {
    normalized = '7' + digits;
  } else {
    throw new BadRequestException({ error: { code: 'INVALID_PHONE', message: 'Неверный формат номера телефона' } });
  }
  if (!normalized.startsWith('7')) {
    throw new BadRequestException({ error: { code: 'INVALID_PHONE', message: 'Поддерживаются только номера +7 (Россия)' } });
  }
  return '+' + normalized;
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashIp(ip: string): string {
  const salt = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);
}

function generateId(): string {
  return createHash('sha256').update(Math.random().toString() + Date.now()).digest('hex').slice(0, 24);
}

export type OtpVerifyResult =
  | { requiresTotp: true }
  | { requiresTotp: false; token: string; user: RequestUser };

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    @Inject(CAPTCHA_VERIFIER) private readonly captcha: CaptchaVerifier,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly auditLog: AuditLogService,
    @Optional() private readonly flags?: FeatureFlagsService,
  ) {}

  /** A-01, TS-30: request an OTP code (normalises phone, checks captcha, enforces rate limits). */
  async requestCode(rawPhone: string, captchaToken: string, ip: string): Promise<void> {
    const phoneE164 = normalizePhone(rawPhone);
    await this.flags?.require('SMS_ENABLED', 'Отправка СМС временно отключена. Войдите через VK ID или Яндекс ID.');

    const captchaOk = await this.captcha.verify(captchaToken, ip);
    if (!captchaOk) {
      throw new BadRequestException({ error: { code: 'INVALID_CAPTCHA', message: 'Проверка капчи не пройдена' } });
    }

    const ipHash = hashIp(ip);
    await this.checkRateLimits(phoneE164, ipHash);

    const code = generateCode();
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.db.insert(schema.otpRequests).values({
      id: generateId(),
      phoneE164,
      codeHash,
      attempts: 0,
      expiresAt,
      ipHash,
    });

    await this.sender.sendCode(phoneE164, code);
  }

  /** A-01: verify OTP code; for admins/moderators with TOTP returns requiresTotp=true. */
  async verifyCode(rawPhone: string, code: string, ip: string, ua: string): Promise<OtpVerifyResult> {
    const phoneE164 = normalizePhone(rawPhone);
    const codeHash = sha256(code);
    const now = new Date();

    const [otp] = await this.db
      .select()
      .from(schema.otpRequests)
      .where(and(eq(schema.otpRequests.phoneE164, phoneE164), gt(schema.otpRequests.expiresAt, now), isNull(schema.otpRequests.usedAt)))
      .orderBy(desc(schema.otpRequests.createdAt))
      .limit(1);

    if (!otp) {
      throw new BadRequestException({ error: { code: 'OTP_EXPIRED', message: 'Код не найден или истёк. Запросите новый.' } });
    }

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException({ error: { code: 'OTP_MAX_ATTEMPTS', message: 'Превышено число попыток. Запросите новый код.' } });
    }

    if (otp.codeHash !== codeHash) {
      await this.db
        .update(schema.otpRequests)
        .set({ attempts: otp.attempts + 1 })
        .where(eq(schema.otpRequests.id, otp.id));
      throw new BadRequestException({ error: { code: 'INVALID_OTP', message: 'Неверный код' } });
    }

    await this.db.update(schema.otpRequests).set({ usedAt: new Date() }).where(eq(schema.otpRequests.id, otp.id));

    const user = await this.findOrCreateUser(phoneE164);

    // AD-01: admins/moderators with TOTP enabled require a second factor.
    if ((user.role === 'ADMIN' || user.role === 'MODERATOR') && user.totpSecretEnc) {
      await this.auditLog.log({ actorId: user.id, action: 'OTP_VERIFIED_TOTP_REQUIRED', targetType: 'user', targetId: user.id, ip });
      return { requiresTotp: true };
    }

    const token = await this.sessions.create(user.id, { ip, ua });
    return { requiresTotp: false, token, user };
  }

  /** AD-01: second factor — verify TOTP or backup code after successful OTP. */
  async verifyTotp(rawPhone: string, totpCode: string, ip: string, ua: string): Promise<{ token: string; user: RequestUser }> {
    const phoneE164 = normalizePhone(rawPhone);

    // Check that OTP was verified recently (within 5 min) for this phone.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [recentOtp] = await this.db
      .select()
      .from(schema.otpRequests)
      .where(and(eq(schema.otpRequests.phoneE164, phoneE164), gt(schema.otpRequests.usedAt, fiveMinAgo)))
      .orderBy(desc(schema.otpRequests.createdAt))
      .limit(1);

    if (!recentOtp) {
      throw new UnauthorizedException({ error: { code: 'OTP_NOT_VERIFIED', message: 'Сначала выполните вход по SMS-коду' } });
    }

    const [userRow] = await this.db.select().from(schema.users).where(eq(schema.users.phoneE164, phoneE164)).limit(1);
    if (!userRow || !userRow.totpSecretEnc) {
      throw new UnauthorizedException({ error: { code: 'TOTP_NOT_ENABLED', message: 'TOTP не настроен для этого аккаунта' } });
    }

    const isValidTotp = this.totp.verifyTotpCode(userRow.totpSecretEnc, totpCode);
    let usedBackup = false;
    if (!isValidTotp) {
      usedBackup = await this.totp.verifyAndConsumeBackupCode(userRow.id, totpCode);
      if (!usedBackup) {
        await this.auditLog.log({ actorId: userRow.id, action: 'TOTP_FAILED', targetType: 'user', targetId: userRow.id, ip });
        throw new BadRequestException({ error: { code: 'INVALID_TOTP', message: 'Неверный код TOTP' } });
      }
    }

    const requestUser: RequestUser = { id: userRow.id, role: userRow.role, status: userRow.status, displayName: userRow.displayName, phoneE164: userRow.phoneE164 };
    const token = await this.sessions.create(userRow.id, { ip, ua });
    await this.auditLog.log({
      actorId: userRow.id,
      action: usedBackup ? 'TOTP_LOGIN_BACKUP' : 'TOTP_LOGIN',
      targetType: 'user',
      targetId: userRow.id,
      ip,
    });
    return { token, user: requestUser };
  }

  private async checkRateLimits(phoneE164: string, ipHash: string): Promise<void> {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const d = new Date(now);
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const [[ph], [pd], [ipH], [daily]] = await Promise.all([
      this.db.select({ n: count() }).from(schema.otpRequests).where(and(eq(schema.otpRequests.phoneE164, phoneE164), gt(schema.otpRequests.createdAt, oneHourAgo))),
      this.db.select({ n: count() }).from(schema.otpRequests).where(and(eq(schema.otpRequests.phoneE164, phoneE164), gt(schema.otpRequests.createdAt, oneDayAgo))),
      this.db.select({ n: count() }).from(schema.otpRequests).where(and(eq(schema.otpRequests.ipHash, ipHash), gt(schema.otpRequests.createdAt, oneHourAgo))),
      this.db.select({ n: count() }).from(schema.otpRequests).where(gt(schema.otpRequests.createdAt, todayStart)),
    ]);

    if ((ph?.n ?? 0) >= PHONE_HOUR_LIMIT) {
      throw new HttpException({ error: { code: 'RATE_LIMIT_PHONE_HOUR', message: 'Слишком много запросов. Попробуйте через час.' } }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((pd?.n ?? 0) >= PHONE_DAY_LIMIT) {
      throw new HttpException({ error: { code: 'RATE_LIMIT_PHONE_DAY', message: 'Слишком много запросов за сутки. Попробуйте завтра.' } }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((ipH?.n ?? 0) >= IP_HOUR_LIMIT) {
      throw new HttpException({ error: { code: 'RATE_LIMIT_IP', message: 'Слишком много запросов с этого адреса.' } }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((daily?.n ?? 0) >= this.config.smsDailyBudget) {
      throw new ServiceUnavailableException({ error: { code: 'SMS_BUDGET_EXCEEDED', message: 'СМС временно недоступны. Войдите через VK или Яндекс.' } });
    }
  }

  private async findOrCreateUser(phoneE164: string): Promise<RequestUser & { totpSecretEnc?: string | null }> {
    const existing = await this.db.select().from(schema.users).where(eq(schema.users.phoneE164, phoneE164)).limit(1);
    if (existing[0]) {
      const u = existing[0];
      // AD-01: promote to ADMIN if this is the configured admin phone and role is still USER.
      if (this.config.adminPhone && u.phoneE164 === this.config.adminPhone && u.role === 'USER') {
        await this.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.id, u.id));
        await this.auditLog.log({ actorId: u.id, action: 'ADMIN_ROLE_GRANTED', targetType: 'user', targetId: u.id });
        return { id: u.id, role: 'ADMIN', status: u.status, displayName: u.displayName, phoneE164: u.phoneE164, totpSecretEnc: u.totpSecretEnc };
      }
      return { id: u.id, role: u.role, status: u.status, displayName: u.displayName, phoneE164: u.phoneE164, totpSecretEnc: u.totpSecretEnc };
    }

    const id = generateId();
    // AD-01: first login for the admin phone creates user with ADMIN role.
    const role = this.config.adminPhone && phoneE164 === this.config.adminPhone ? 'ADMIN' : 'USER';
    // AD-07: the first administrator can always get in; for others the door is shut while registration is off.
    if (role !== 'ADMIN') await this.flags?.require('REGISTRATION_ENABLED', 'Регистрация новых пользователей временно закрыта. Попробуйте позже.');
    await this.db.insert(schema.users).values({ id, phoneE164, displayName: phoneE164, role, status: 'ACTIVE' });
    if (role === 'ADMIN') {
      await this.auditLog.log({ actorId: id, action: 'ADMIN_ROLE_GRANTED', targetType: 'user', targetId: id });
    }
    return { id, role, status: 'ACTIVE', displayName: phoneE164, phoneE164, totpSecretEnc: null };
  }
}
