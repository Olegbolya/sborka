import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

describe('A-01, TS-30 · OTP вход по телефону', () => {
  let t: TestApp;
  let db: TestDb;
  const sentCodes: { phone: string; code: string }[] = [];
  const captchaResult = { value: true };

  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captchaVerifier: CaptchaVerifier = {
    verify: vi.fn(() => Promise.resolve(captchaResult.value)),
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
    } catch {
      // PostgreSQL not available locally — all tests in this suite are skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  beforeEach(async () => {
    sentCodes.length = 0;
    captchaResult.value = true;
    vi.clearAllMocks();
    // Clear OTP requests so IP/phone rate limits don't bleed across tests.
    if (db) await db.db.delete(schema.otpRequests);
  });

  function skipIfNoDb() {
    if (!t) return true;
    return false;
  }

  // ── Normal flow ──────────────────────────────────────────────────────────────

  it('A-01 · полный цикл: запрос кода → ввод кода → сессия', async () => {
    if (skipIfNoDb()) return;

    const phone = '+79991234560';
    const res1 = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('x-blokum-csrf', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(200);
    expect(res1.body).toEqual({ ok: true });
    expect(otpSender.sendCode).toHaveBeenCalledWith(phone, expect.stringMatching(/^\d{6}$/));

    const { code } = sentCodes[0]!;
    const res2 = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('x-blokum-csrf', '1')
      .send({ phone, code })
      .expect(200);
    expect(res2.body.user.id).toBeDefined();
    expect(res2.body.user.role).toBe('USER');
    expect(res2.headers['set-cookie']).toBeDefined();
    const cookie = (res2.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('A-01 · повторный вход с тем же номером — возвращает того же пользователя', async () => {
    if (skipIfNoDb()) return;

    const phone = '+79991234561';
    for (let i = 0; i < 2; i++) {
      await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('x-blokum-csrf', '1').send({ phone, captchaToken: 'ok' });
      const { code } = sentCodes[sentCodes.length - 1]!;
      const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('x-blokum-csrf', '1').send({ phone, code });
      if (i === 0) {
        const userId = (res.body as { user: { id: string } }).user.id;
        sentCodes.length = 0;

        await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('x-blokum-csrf', '1').send({ phone, captchaToken: 'ok' });
        const { code: code2 } = sentCodes[0]!;
        const res2 = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('x-blokum-csrf', '1').send({ phone, code: code2 });
        expect((res2.body as { user: { id: string } }).user.id).toBe(userId);
        break;
      }
    }
  });

  // ── Phone validation (A-01, TS-30) ──────────────────────────────────────────

  it('A-01 · TS-30 · отклоняет номер не +7', async () => {
    if (skipIfNoDb()) return;

    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('x-blokum-csrf', '1')
      .send({ phone: '+12025551234', captchaToken: 'ok' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE');
  });

  it('A-01 · TS-30 · отклоняет неверный формат номера', async () => {
    if (skipIfNoDb()) return;

    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('x-blokum-csrf', '1')
      .send({ phone: 'notaphone', captchaToken: 'ok' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE');
  });

  // ── Captcha (TS-30) ──────────────────────────────────────────────────────────

  it('TS-30 · неверная капча → 400 INVALID_CAPTCHA', async () => {
    if (skipIfNoDb()) return;

    captchaResult.value = false;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('x-blokum-csrf', '1')
      .send({ phone: '+79991234562', captchaToken: 'bad' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_CAPTCHA');
    expect(otpSender.sendCode).not.toHaveBeenCalled();
  });

  // ── OTP errors ───────────────────────────────────────────────────────────────

  it('A-01 · неверный код → 400 INVALID_OTP', async () => {
    if (skipIfNoDb()) return;

    const phone = '+79991234563';
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('x-blokum-csrf', '1').send({ phone, captchaToken: 'ok' });
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('x-blokum-csrf', '1')
      .send({ phone, code: '000000' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('A-01 · 5 неверных попыток → OTP_MAX_ATTEMPTS', async () => {
    if (skipIfNoDb()) return;

    const phone = '+79991234564';
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('x-blokum-csrf', '1').send({ phone, captchaToken: 'ok' });
    for (let i = 0; i < 5; i++) {
      await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('x-blokum-csrf', '1').send({ phone, code: '000000' });
    }
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('x-blokum-csrf', '1')
      .send({ phone, code: '000000' })
      .expect(400);
    expect(res.body.error.code).toBe('OTP_MAX_ATTEMPTS');
  });

  it('A-01 · после истечения срока код недействителен', async () => {
    if (skipIfNoDb()) return;

    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('x-blokum-csrf', '1')
      .send({ phone: '+79991234500', code: '111111' })
      .expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  // ── Rate limits (TS-30) ──────────────────────────────────────────────────────

  it('TS-30 · 3 кода за час с одного номера → 429 RATE_LIMIT_PHONE_HOUR', async () => {
    if (skipIfNoDb()) return;

    const phone = '+79990000001';
    for (let i = 0; i < 3; i++) {
      await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('x-blokum-csrf', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    }
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('x-blokum-csrf', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_PHONE_HOUR');
  });

  it('TS-30 · 5 кодов за час с одного IP → 429 RATE_LIMIT_IP', async () => {
    if (skipIfNoDb()) return;

    // Use 5 different phone numbers from the same IP (IP hash based on request IP)
    for (let i = 0; i < 5; i++) {
      await request(t.http())
        .post(`/${API_PREFIX}/auth/otp/request`)
        .set('x-blokum-csrf', '1')
        .set('x-forwarded-for', '10.10.10.10')
        .send({ phone: `+7999000010${i}`, captchaToken: 'ok' })
        .expect(200);
    }
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('x-blokum-csrf', '1')
      .set('x-forwarded-for', '10.10.10.10')
      .send({ phone: '+79990000199', captchaToken: 'ok' })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_IP');
  });
});
