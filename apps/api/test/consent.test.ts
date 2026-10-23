import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

describe('A-02, D1/D4/D9 · Онбординг и согласия', () => {
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
    if (db) {
      await db.db.delete(schema.consentRecords);
      await db.db.delete(schema.otpRequests);
    }
  });

  function skip() {
    return !t;
  }

  /** Logs in via OTP and returns the session cookie string. */
  async function loginViaOtp(phone: string): Promise<string> {
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes[sentCodes.length - 1]!;
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

  // ── Legal document retrieval (D1, D4, D9) ──────────────────────────────────

  it('D1 · GET /legal/documents/tos → возвращает черновик ПС', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/legal/documents/tos`)
      .expect(200);
    expect(res.body.type).toBe('TOS');
    expect(res.body.version).toBeGreaterThanOrEqual(1);
    expect(res.body.title).toBe('Пользовательское соглашение');
    expect(res.body.isDraft).toBe(true);
    expect(res.body.id).toBeTruthy();
  });

  it('D4 · GET /legal/documents/pd-consent-user → возвращает черновик согласия на ПД', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/legal/documents/pd-consent-user`)
      .expect(200);
    expect(res.body.type).toBe('PD_CONSENT_USER');
    expect(res.body.version).toBeGreaterThanOrEqual(1);
    expect(res.body.title).toBe('Согласие на обработку персональных данных');
    expect(res.body.isDraft).toBe(true);
  });

  it('D9 · GET /legal/documents/marketing → возвращает черновик согласия на рассылки', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/legal/documents/marketing`)
      .expect(200);
    expect(res.body.type).toBe('MARKETING');
    expect(res.body.version).toBeGreaterThanOrEqual(1);
    expect(res.body.isDraft).toBe(true);
  });

  it('D1 · GET /legal/documents/unknown → 400', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/legal/documents/unknown-type`)
      .expect(400);
    expect(res.body.error?.code).toBe('DOCUMENT_NOT_FOUND');
  });

  // ── Onboarding status ───────────────────────────────────────────────────────

  it('A-02 · GET /auth/onboarding → новый пользователь: pending = [TOS, PD_CONSENT_USER]', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230001');
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/onboarding`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.completed).toBe(false);
    const types = (res.body.pending as Array<{ type: string }>).map((d) => d.type);
    expect(types).toContain('TOS');
    expect(types).toContain('PD_CONSENT_USER');
  });

  it('A-02 · GET /auth/onboarding → 401 без авторизации', async () => {
    if (skip()) return;
    await request(t.http())
      .get(`/${API_PREFIX}/auth/onboarding`)
      .expect(401);
  });

  // ── Record consents ─────────────────────────────────────────────────────────

  it('A-02 · POST /auth/onboarding/consent → запись без ageConfirmed → 400', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230002');
    const tosRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos`).expect(200);
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [tosRes.body.id], ageConfirmed: false })
      .expect(400);
    expect(res.body.error?.code).toBe('AGE_NOT_CONFIRMED');
  });

  it('A-02 · POST /auth/onboarding/consent → принимает TOS и ПД, onboarding completed', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230003');

    const tosRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos`).expect(200);
    const pdRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/pd-consent-user`).expect(200);

    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [tosRes.body.id, pdRes.body.id], ageConfirmed: true })
      .expect(200);
    expect(res.body).toEqual({ ok: true });

    // Onboarding is now complete.
    const statusRes = await request(t.http())
      .get(`/${API_PREFIX}/auth/onboarding`)
      .set('Cookie', cookie)
      .expect(200);
    expect(statusRes.body.completed).toBe(true);
    expect(statusRes.body.pending).toHaveLength(0);
  });

  it('A-02 · по одной записи на каждый документ с версией', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230004');

    const tosRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos`).expect(200);
    const pdRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/pd-consent-user`).expect(200);

    await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [tosRes.body.id, pdRes.body.id], ageConfirmed: true })
      .expect(200);

    // Verify separate records in DB per document.
    const records = await db.db
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.subjectType, 'USER'));

    const tosRecord = records.find((r) => r.legalDocumentId === tosRes.body.id);
    const pdRecord = records.find((r) => r.legalDocumentId === pdRes.body.id);

    expect(tosRecord).toBeDefined();
    expect(pdRecord).toBeDefined();

    // Each record must carry version evidence.
    expect((tosRecord!.evidence as { checkboxText: string }).checkboxText).toContain('версии');
    expect((pdRecord!.evidence as { checkboxText: string }).checkboxText).toContain('версии');
  });

  it('A-02 · необязательное согласие на рассылки принимается вместе с обязательными', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230005');

    const tosRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos`).expect(200);
    const pdRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/pd-consent-user`).expect(200);
    const mktRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/marketing`).expect(200);

    await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [tosRes.body.id, pdRes.body.id], ageConfirmed: true, marketingConsentDocId: mktRes.body.id })
      .expect(200);

    const records = await db.db
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.subjectType, 'USER'));

    expect(records.find((r) => r.legalDocumentId === mktRes.body.id)).toBeDefined();
  });

  it('A-02 · повторное принятие при новой версии документа', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230006');

    // Initial onboarding.
    const tosRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos`).expect(200);
    const pdRes = await request(t.http()).get(`/${API_PREFIX}/legal/documents/pd-consent-user`).expect(200);
    await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: [tosRes.body.id, pdRes.body.id], ageConfirmed: true })
      .expect(200);

    // Simulate a new TOS version inserted directly.
    const currentVersion = tosRes.body.version as number;
    const { createHash } = await import('node:crypto');
    const newBody = `# Новая версия ${Date.now()}`;
    const newSha = createHash('sha256').update(newBody, 'utf8').digest('hex');
    await db.db.insert(schema.legalDocuments).values({
      id: `test-tos-v${currentVersion + 1}`,
      type: 'TOS',
      version: currentVersion + 1,
      title: 'Пользовательское соглашение',
      bodyMd: newBody,
      contentSha256: newSha,
    });

    // Onboarding should be incomplete again.
    const statusRes = await request(t.http())
      .get(`/${API_PREFIX}/auth/onboarding`)
      .set('Cookie', cookie)
      .expect(200);
    expect(statusRes.body.completed).toBe(false);
    const types = (statusRes.body.pending as Array<{ type: string }>).map((d) => d.type);
    expect(types).toContain('TOS');
  });

  it('A-02 · POST /auth/onboarding/consent → недопустимый documentId → 400', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230007');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: ['nonexistent-id'], ageConfirmed: true })
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_DOCUMENT');
  });

  it('A-02 · POST /auth/onboarding/consent → documentIds не массив → 400', async () => {
    if (skip()) return;
    const cookie = await loginViaOtp('+79991230008');
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/onboarding/consent`)
      .set('Cookie', cookie)
      .set('X-Blokum-CSRF', '1')
      .send({ documentIds: 'not-an-array', ageConfirmed: true })
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_INPUT');
  });
});
