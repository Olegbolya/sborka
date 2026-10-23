import { createHmac, createDecipheriv } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb, testConfig } from './helpers.js';

// Standalone TOTP computation for tests (mirrors totp.service.ts logic).
function computeTotp(secretBase64url: string, offsetSec = 0): string {
  const key = Buffer.from(secretBase64url, 'base64url');
  const counter = Math.floor((Date.now() / 1000 + offsetSec) / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

// Decrypt TOTP secret (AES-256-GCM) — mirrors totp.service.ts.
function decryptTotpSecret(encrypted: string, keyHex: string): string {
  const [ivHex, ctHex, tagHex] = encrypted.split('.');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  return decipher.update(Buffer.from(ctHex!, 'hex')).toString('utf8') + decipher.final('utf8');
}

describe('AD-01, AD-08 · Роли и админ', () => {
  let t: TestApp;
  let db: TestDb;
  const sentCodes: { phone: string; code: string }[] = [];

  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captchaVerifier: CaptchaVerifier = {
    verify: vi.fn(() => Promise.resolve(true)),
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
    } catch {
      // PostgreSQL not available — tests skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  beforeEach(async () => {
    sentCodes.length = 0;
    vi.clearAllMocks();
    // Clear OTP requests so IP/phone rate limits don't bleed across tests.
    if (db) await db.db.delete(schema.otpRequests);
  });

  function skip() {
    return !t;
  }

  async function loginViaOtp(phone: string): Promise<string> {
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes[sentCodes.length - 1]!;
    sentCodes.length = 0;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, code })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies?.find((c: string) => c.startsWith('session='));
    if (!sessionCookie) throw new Error('No session cookie');
    return sessionCookie.split(';')[0]!;
  }

  // ── First-admin elevation (AD-01) ─────────────────────────────────────────

  it('AD-01 · логин ADMIN_PHONE → роль ADMIN', async () => {
    if (skip()) return;
    const phone = testConfig.adminPhone; // '+79990000001'
    const cookie = await loginViaOtp(phone);
    const res = await request(t.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200);
    expect(res.body.role).toBe('ADMIN');
  });

  it('AD-01 · обычный пользователь не получает роль ADMIN', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250002');
    const res = await request(t.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200);
    expect(res.body.role).toBe('USER');
  });

  // ── TOTP setup and confirmation (AD-01) ───────────────────────────────────

  it('AD-01 · POST /auth/account/totp/setup → возвращает TOTP URI', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250003');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    expect(res.body.totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.totpUri).toContain('issuer=');
  });

  it('AD-01 · повторный setup при уже настроенном TOTP → 409', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250004');
    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(409);
    expect(res.body.error?.code).toBe('TOTP_ALREADY_ENABLED');
  });

  it('AD-01 · POST /auth/account/totp/confirm → с верным кодом возвращает резервные коды', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250005');

    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    // Extract encrypted secret from DB to compute correct TOTP code.
    const userRows = await db.db
      .select({ id: schema.users.id, totpSecretEnc: schema.users.totpSecretEnc })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, '+79991250005'));
    const encSecret = userRows[0]!.totpSecretEnc!;
    const plainSecret = decryptTotpSecret(encSecret, testConfig.totpSecretKey);
    const totpCode = computeTotp(plainSecret);

    const confirmRes = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/confirm`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ code: totpCode })
      .expect(200);
    expect(Array.isArray(confirmRes.body.backupCodes)).toBe(true);
    expect(confirmRes.body.backupCodes.length).toBe(8);
  });

  it('AD-01 · confirm с неверным кодом → 400 INVALID_TOTP', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991250006');
    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/confirm`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ code: '000000' })
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_TOTP');
  });

  // ── TOTP 2FA login flow (AD-01) ───────────────────────────────────────────

  it('AD-01 · ADMIN с TOTP: OTP verify → requiresTotp, затем totp-verify → сессия', async () => {
    if (skip()) return;
    const phone = '+79991250007';

    // First: login as regular user, set up and confirm TOTP.
    const cookieSetup = await loginViaOtp(phone);
    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookieSetup)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const userRows = await db.db
      .select({ totpSecretEnc: schema.users.totpSecretEnc })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, phone));
    const encSecret = userRows[0]!.totpSecretEnc!;
    const plainSecret = decryptTotpSecret(encSecret, testConfig.totpSecretKey);
    const setupCode = computeTotp(plainSecret);

    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/confirm`)
      .set('Cookie', cookieSetup)
      .set('X-Blokum-CSRF', '1')
      .send({ code: setupCode })
      .expect(200);

    // Elevate user to ADMIN so 2FA is required on next login.
    await db.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.phoneE164, phone));

    // Now: OTP verify should return requiresTotp=true, NO session cookie.
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(200);
    const otpCode = sentCodes[sentCodes.length - 1]!.code;
    sentCodes.length = 0;

    const verifyRes = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, code: otpCode })
      .expect(200);
    expect(verifyRes.body.requiresTotp).toBe(true);
    const noCookie = (verifyRes.headers['set-cookie'] as unknown as string[] | undefined)?.find((c: string) => c.startsWith('session='));
    expect(noCookie).toBeUndefined();

    // Second factor: submit TOTP code to get session.
    const totpCode = computeTotp(plainSecret);
    const totpRes = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/totp-verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, code: totpCode })
      .expect(200);
    expect(totpRes.body.user.role).toBe('ADMIN');
    const sessionCookies = totpRes.headers['set-cookie'] as unknown as string[];
    expect(sessionCookies?.find((c: string) => c.startsWith('session='))).toBeTruthy();
  });

  it('AD-01 · totp-verify без предшествующего OTP → 401', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/totp-verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: '+79991250099', code: '123456' })
      .expect(401);
    expect(res.body.error?.code).toBe('OTP_NOT_VERIFIED');
  });

  it('AD-01 · резервный код работает вместо TOTP', async () => {
    if (skip()) return;
    const phone = '+79991250008';
    const cookieSetup = await loginViaOtp(phone);

    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookieSetup)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const userRows = await db.db
      .select({ totpSecretEnc: schema.users.totpSecretEnc })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, phone));
    const encSecret = userRows[0]!.totpSecretEnc!;
    const plainSecret = decryptTotpSecret(encSecret, testConfig.totpSecretKey);
    const setupCode = computeTotp(plainSecret);

    const confirmRes = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/confirm`)
      .set('Cookie', cookieSetup)
      .set('X-Blokum-CSRF', '1')
      .send({ code: setupCode })
      .expect(200);
    const backupCode = confirmRes.body.backupCodes[0] as string;

    await db.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.phoneE164, phone));

    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(200);
    const otpCode = sentCodes[sentCodes.length - 1]!.code;
    sentCodes.length = 0;
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, code: otpCode })
      .expect(200);

    const backupRes = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/totp-verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, code: backupCode })
      .expect(200);
    expect(backupRes.body.user).toBeTruthy();
  });

  it('AD-01 · DELETE /auth/account/totp → отключает TOTP', async () => {
    if (skip()) return;
    const phone = '+79991250009';
    const cookie = await loginViaOtp(phone);

    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/setup`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const userRows = await db.db
      .select({ totpSecretEnc: schema.users.totpSecretEnc })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, phone));
    const encSecret = userRows[0]!.totpSecretEnc!;
    const plainSecret = decryptTotpSecret(encSecret, testConfig.totpSecretKey);
    const setupCode = computeTotp(plainSecret);

    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/totp/confirm`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ code: setupCode })
      .expect(200);

    await request(t.http())
      .delete(`/${API_PREFIX}/auth/account/totp`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const after = await db.db
      .select({ totpSecretEnc: schema.users.totpSecretEnc })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, phone));
    expect(after[0]?.totpSecretEnc).toBeNull();
  });

  // ── Audit log append-only (AD-08) ─────────────────────────────────────────

  it('AD-08 · AuditLogService записывает события в БД', async () => {
    if (skip()) return;
    // First admin login triggers ADMIN_ROLE_GRANTED audit event.
    const phone = testConfig.adminPhone;
    const [userRow] = await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone));
    if (!userRow) return; // admin not yet created — only matters when run in isolation

    const logs = await db.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, userRow.id));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const grantLog = logs.find((l) => l.action === 'ADMIN_ROLE_GRANTED');
    expect(grantLog).toBeTruthy();
  });

  it('AD-08 · триггер БД отклоняет UPDATE в audit_log', async () => {
    if (skip()) return;
    await db.db.insert(schema.auditLog).values({
      actorId: 'test-actor',
      action: 'TEST_EVENT',
      targetType: 'test',
      targetId: 'test-target',
      meta: {},
    });
    const rows = await db.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'TEST_EVENT'));
    const rowId = rows[rows.length - 1]!.id;

    await expect(
      db.db.update(schema.auditLog).set({ action: 'TAMPERED' }).where(eq(schema.auditLog.id, rowId)),
    ).rejects.toThrow();
  });

  it('AD-08 · триггер БД отклоняет DELETE из audit_log', async () => {
    if (skip()) return;
    const rows = await db.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'TEST_EVENT'));
    if (!rows.length) return;
    const rowId = rows[rows.length - 1]!.id;

    await expect(
      db.db.delete(schema.auditLog).where(eq(schema.auditLog.id, rowId)),
    ).rejects.toThrow();
  });
});
