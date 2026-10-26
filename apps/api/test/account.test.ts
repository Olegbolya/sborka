import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { EmailSender } from '../src/auth/email-sender.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

describe('A-03, A-05, D-10 · Аккаунт', () => {
  let t: TestApp;
  let db: TestDb;
  const sentCodes: { phone: string; code: string }[] = [];
  const sentEmails: { to: string; url: string }[] = [];

  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captchaVerifier: CaptchaVerifier = {
    verify: vi.fn(() => Promise.resolve(true)),
  };
  const emailSender: EmailSender = {
    sendVerification: vi.fn((to: string, url: string) => {
      sentEmails.push({ to, url });
      return Promise.resolve();
    }),
  };

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier, emailSender });
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
    sentEmails.length = 0;
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
    const sessionCookie = cookies.find((c) => c.startsWith('session='));
    if (!sessionCookie) throw new Error('No session cookie');
    return sessionCookie.split(';')[0]!;
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  it('D-10 · GET /auth/account → возвращает профиль', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240001');
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/account`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.phoneE164).toBe('+79991240001');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.role).toBe('USER');
    expect(res.body.id).toBeTruthy();
  });

  it('D-10 · PATCH /auth/account → обновляет отображаемое имя', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240002');
    await request(t.http())
      .patch(`/${API_PREFIX}/auth/account`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ displayName: 'Иван Петров' })
      .expect(200);

    const res = await request(t.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200);
    expect(res.body.displayName).toBe('Иван Петров');
  });

  it('D-10 · PATCH /auth/account → пустое имя → 400', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240003');
    const res = await request(t.http())
      .patch(`/${API_PREFIX}/auth/account`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ displayName: '   ' })
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_INPUT');
  });

  // ── Email verification ───────────────────────────────────────────────────

  it('A-03 · POST /auth/account/email → отправляет ссылку подтверждения', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240004');
    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/email`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ email: 'test@example.ru' })
      .expect(200);
    expect(sentEmails[0]?.to).toBe('test@example.ru');
    expect(sentEmails[0]?.url).toContain('token=');
  });

  it('A-03 · GET /auth/account/email/verify → подтверждает email', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240005');
    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/email`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ email: 'user5@example.ru' })
      .expect(200);

    const verifyUrl = sentEmails[0]!.url;
    const token = new URL(verifyUrl).searchParams.get('token')!;

    // Follow verification link (redirects to /account).
    await request(t.http())
      .get(`/${API_PREFIX}/auth/account/email/verify?token=${token}`)
      .expect(302);

    // Email should now be verified.
    const profile = await request(t.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200);
    expect(profile.body.email).toBe('user5@example.ru');
    expect(profile.body.emailVerifiedAt).toBeTruthy();
  });

  it('A-03 · verify с недействительным токеном → 400', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/account/email/verify?token=badtoken`)
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_TOKEN');
  });

  it('A-03 · повторная верификация уже использованного токена → TOKEN_USED', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240020');
    await request(t.http()).post(`/${API_PREFIX}/auth/account/email`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ email: 'used@example.ru' }).expect(200);
    const token = new URL(sentEmails[0]!.url).searchParams.get('token')!;
    await request(t.http()).get(`/${API_PREFIX}/auth/account/email/verify?token=${token}`).expect(302);
    const res = await request(t.http()).get(`/${API_PREFIX}/auth/account/email/verify?token=${token}`).expect(400);
    expect(res.body.error?.code).toBe('TOKEN_USED');
  });

  it('A-03 · верификация истёкшего токена → TOKEN_EXPIRED', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240021');
    await request(t.http()).post(`/${API_PREFIX}/auth/account/email`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ email: 'expired@example.ru' }).expect(200);
    const token = new URL(sentEmails[0]!.url).searchParams.get('token')!;
    await db.db.update(schema.emailVerificationTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.emailVerificationTokens.tokenHash, createHash('sha256').update(token).digest('hex')));
    const res = await request(t.http()).get(`/${API_PREFIX}/auth/account/email/verify?token=${token}`).expect(400);
    expect(res.body.error?.code).toBe('TOKEN_EXPIRED');
  });

  it('A-03 · email уже занят другим пользователем → 409', async () => {
    if (skip()) return;
    const cookie1 = await loginViaOtp('+79991240022');
    const cookie2 = await loginViaOtp('+79991240023');
    await request(t.http()).post(`/${API_PREFIX}/auth/account/email`).set('Cookie', cookie1).set('X-Blokum-CSRF', '1').send({ email: 'taken@example.ru' }).expect(200);
    const token = new URL(sentEmails[sentEmails.length - 1]!.url).searchParams.get('token')!;
    await request(t.http()).get(`/${API_PREFIX}/auth/account/email/verify?token=${token}`).expect(302);
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/account/email`).set('Cookie', cookie2).set('X-Blokum-CSRF', '1').send({ email: 'taken@example.ru' }).expect(409);
    expect(res.body.error?.code).toBe('EMAIL_TAKEN');
  });

  it('A-05 · восстановить аккаунт после истечения 30 дней → 403', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240024');
    await request(t.http()).delete(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(200);
    await db.db.update(schema.users).set({ deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) }).where(eq(schema.users.phoneE164, '+79991240024'));
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/account/restore`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(403);
    expect(res.body.error?.code).toBe('GRACE_PERIOD_EXPIRED');
  });

  it('A-03 · POST /auth/account/email → некорректный email → 400', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240006');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/email`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_EMAIL');
  });

  // ── Sessions ─────────────────────────────────────────────────────────────

  it('D-10 · GET /auth/account/sessions → возвращает активные сеансы', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240007');
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/account/sessions`)
      .set('Cookie', cookie)
      .expect(200);
    const sessions = res.body as Array<{ isCurrent: boolean; id: string }>;
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const current = sessions.find((s) => s.isCurrent);
    expect(current).toBeDefined();
  });

  // ── Consent history ───────────────────────────────────────────────────────

  it('D-10 · GET /auth/account/consents → история согласий', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240008');

    const tosRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos`).expect(200);
    const pdRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/pd-consent-user`).expect(200);
    await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [tosRes.body.id, pdRes.body.id], ageConfirmed: true })
      .expect(200);

    const consents = await request(t.http()).get(`/${API_PREFIX}/auth/account/consents`).set('Cookie', cookie).expect(200);
    expect(Array.isArray(consents.body)).toBe(true);
    expect(consents.body.length).toBeGreaterThanOrEqual(2);
    expect(consents.body[0].acceptedAt).toBeTruthy();
  });

  it('D-10 · DELETE /auth/account/consents/marketing → отзывает рекламное согласие', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240009');

    const mktRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/marketing`).expect(200);
    await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [], ageConfirmed: true, marketingConsentDocId: mktRes.body.id })
      .expect(200);

    await request(t.http())
      .delete(`/${API_PREFIX}/auth/account/consents/marketing`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const rows = await db.db
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.kind, 'marketing_consent'));
    expect(rows[0]?.withdrawnAt).toBeTruthy();
  });

  // ── Export ────────────────────────────────────────────────────────────────

  it('D-10 · POST /auth/account/export → возвращает JSON с данными пользователя', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240010');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/export`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.profile.phoneE164).toBe('+79991240010');
    expect(res.body.exportedAt).toBeTruthy();
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(Array.isArray(res.body.consentHistory)).toBe(true);
  });

  it('D-10 · экспорт не содержит данных другого пользователя', async () => {
    if (skip()) return;
    const cookie1 = await loginViaOtp('+79991240011');
    const cookie2 = await loginViaOtp('+79991240012');

    const export1 = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/export`)
      .set('Cookie', cookie1)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    const export2 = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/export`)
      .set('Cookie', cookie2)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    expect(export1.body.profile.phoneE164).toBe('+79991240011');
    expect(export2.body.profile.phoneE164).toBe('+79991240012');
    expect(export1.body.profile.phoneE164).not.toBe(export2.body.profile.phoneE164);
  });

  // ── Account deletion (A-05) ───────────────────────────────────────────────

  it('A-05 · DELETE /auth/account → удаляет аккаунт (мягко)', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240013');

    await request(t.http())
      .delete(`/${API_PREFIX}/auth/account`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const rows = await db.db
      .select({ status: schema.users.status, deletedAt: schema.users.deletedAt })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, '+79991240013'));
    expect(rows[0]?.status).toBe('DELETED');
    expect(rows[0]?.deletedAt).toBeTruthy();
  });

  it('A-05 · POST /auth/account/restore → восстанавливает аккаунт в течение 30 дней', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240014');

    // Delete account — sessions remain valid during grace period.
    await request(t.http())
      .delete(`/${API_PREFIX}/auth/account`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    // Restore using the same session (valid during 30-day grace period).
    await request(t.http())
      .post(`/${API_PREFIX}/auth/account/restore`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(200);

    const rows = await db.db
      .select({ status: schema.users.status, deletedAt: schema.users.deletedAt })
      .from(schema.users)
      .where(eq(schema.users.phoneE164, '+79991240014'));
    expect(rows[0]?.status).toBe('ACTIVE');
    expect(rows[0]?.deletedAt).toBeNull();
  });

  it('A-05 · restore на неудалённом аккаунте → 403', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991240015');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/account/restore`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .expect(403);
    expect(res.body.error?.code).toBe('NOT_DELETED');
  });
});

describe('A-03 · почтовый сервис не подключён', () => {
  it('A-03: без почтового сервиса API запускается, профиль сообщает emailAvailable=false, подтверждение адреса — 503 с понятной причиной', async () => {
    const db = await createTestDb();
    const codes: string[] = [];
    const t = await startTestApp({
      db: db.db,
      otpSender: { sendCode: (_p: string, code: string) => (codes.push(code), Promise.resolve()) },
      captchaVerifier: { verify: () => Promise.resolve(true) },
      emailSender: null,
    });
    const phone = '+79991249901';
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code: codes[0] }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const profile = await request(t.http()).get(`/${API_PREFIX}/auth/account`).set('Cookie', cookie).expect(200);
    expect(profile.body.emailAvailable).toBe(false);
    const email = await request(t.http()).post(`/${API_PREFIX}/auth/account/email`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ email: 'u@example.ru' });
    expect(email.status).toBe(503);
    expect(email.body.error.code).toBe('EMAIL_UNAVAILABLE');
    await t.app.close();
    await db.drop();
  });
});
