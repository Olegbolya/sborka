import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { createBlock, createDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

// ─── helpers ───────────────────────────────────────────────────────────────

let phoneCounter = 0;

async function setupWithAuth() {
  const db = await createTestDb();
  const sentCodes: { phone: string; code: string }[] = [];
  const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => { sentCodes.push({ phone, code }); return Promise.resolve(); }) };
  const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
  const t = await startTestApp({ db: db.db, otpSender, captchaVerifier });

  async function login(): Promise<string> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(2000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookies = (res.headers['set-cookie'] ?? []) as string[];
    return cookies.find((c) => c.startsWith('session='))!.split(';')[0]!;
  }

  return { t, db, login };
}

// ─── P8.1 · Тексты публичных документов ─────────────────────────────────

describe('P8.1/D1–D12 · Тексты публичных документов', () => {
  let t: TestApp;
  let db: TestDb;

  beforeAll(async () => {
    try {
      ({ t, db } = await setupWithAuth());
    } catch {
      // PostgreSQL not available — tests skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  const ALL_DOC_TYPES = [
    'tos', 'offer', 'privacy', 'pd-consent-user', 'participant-consent-template',
    'dpa', 'content-rules', 'cookies', 'marketing', 'complaints', 'contacts', 'participant-notice',
  ];

  for (const typeSlug of ALL_DOC_TYPES) {
    it(`P8.1: документ ${typeSlug} сидирован и доступен публично`, async () => {
      if (!t) return;
      const res = await request(t.http()).get(`/${API_PREFIX}/legal/documents/${typeSlug}`).expect(200);
      expect(res.body).toMatchObject({ type: typeSlug.toUpperCase().replace(/-/g, '_'), isDraft: true });
      expect(typeof res.body.bodyMd).toBe('string');
      expect(res.body.bodyMd.length).toBeGreaterThan(100);
    });
  }
});

// ─── P8.2 · Юридические страницы и версии (AD-06) ───────────────────────

describe('AD-06 · Версии юридических документов', () => {
  let t: TestApp;
  let db: TestDb;

  beforeAll(async () => {
    try {
      ({ t, db } = await setupWithAuth());
    } catch {
      // PostgreSQL not available — tests skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('AD-06: GET /legal/documents/tos/versions возвращает массив версий', async () => {
    if (!t) return;
    const res = await request(t.http()).get(`/${API_PREFIX}/legal/documents/tos/versions`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const v = res.body[0] as { version: number; bodyMd: string; isDraft: boolean };
    expect(v.version).toBeGreaterThanOrEqual(1);
    expect(v.isDraft).toBe(true);
  });

  it('AD-06: несуществующий тип → 400', async () => {
    if (!t) return;
    await request(t.http()).get(`/${API_PREFIX}/legal/documents/nonexistent/versions`).expect(400);
  });
});

// ─── P8.3 · Сбор ПД участников (PL-23, B-19, B-20) ───────────────────────

/** A valid document with a contacts block and the consent under it (publishing refuses documents the schema does not accept). */
function documentWithContacts(title: string) {
  const doc = createDocument({ title });
  doc.screens[0]!.blocks.push(createBlock('contacts'), createBlock('consent'));
  return doc as unknown as schema.ProjectDocumentJson;
}

describe('PL-23/B-19/B-20 · Оператор ПД и DPA', () => {
  let t: TestApp;
  let db: TestDb;
  let cookie: string;
  let projectId: string;
  let loginFn: () => Promise<string>;

  beforeAll(async () => {
    try {
      const res = await setupWithAuth();
      t = res.t;
      db = res.db;
      loginFn = res.login;
      cookie = await res.login();

      const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'ПД-тест' }).expect(200);
      projectId = proj.body.id as string;
    } catch {
      // PostgreSQL not available — tests skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  it('PL-23: GET operator-info на новом проекте возвращает null', async () => {
    if (!t) return;
    const res = await request(t.http()).get(`/${API_PREFIX}/projects/${projectId}/operator-info`).set('Cookie', cookie).expect(200);
    expect(res.body.operatorInfo).toBeNull();
    expect(res.body.dpaAcceptedAt).toBeNull();
  });

  it('PL-23: PATCH operator-info сохраняет данные оператора', async () => {
    if (!t) return;
    const info = { name: 'Иванов Иван Иванович', email: 'ivan@example.com', purpose: 'Опрос клиентов', retentionPeriod: '1 год' };
    const res = await request(t.http()).patch(`/${API_PREFIX}/projects/${projectId}/operator-info`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send(info).expect(200);
    expect(res.body.name).toBe(info.name);
    expect(res.body.email).toBe(info.email);
  });

  it('PL-23: POST dpa-accept фиксирует принятие DPA', async () => {
    if (!t) return;
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${projectId}/dpa-accept`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(200);
    expect(res.body.acceptedAt).toBeTruthy();

    const info = await request(t.http()).get(`/${API_PREFIX}/projects/${projectId}/operator-info`).set('Cookie', cookie).expect(200);
    expect(info.body.dpaAcceptedAt).toBeTruthy();
  });

  it('B-19/PL-23: проект без B-19 публикуется без operatorInfo', async () => {
    if (!t) return;
    // A plain project (no contacts block) can be published freely.
    await request(t.http()).post(`/${API_PREFIX}/projects/${projectId}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(200);
    await request(t.http()).post(`/${API_PREFIX}/projects/${projectId}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'DRAFT' }).expect(200);
  });

  it('B-19/PL-23: проект с B-19 не публикуется без operatorInfo', async () => {
    if (!t) return;
    // Create a separate project for this test
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 тест' }).expect(200);
    const pid = proj.body.id as string;
    // Inject a contacts block into the draft version document
    const docWithContacts = documentWithContacts('B-19 тест');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    // Publish without operatorInfo → OPERATOR_INFO_REQUIRED
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/OPERATOR_INFO_REQUIRED/);
  });

  it('B-19/PL-23: проект с B-19 + operatorInfo, но без DPA — не публикуется', async () => {
    if (!t) return;
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 DPA тест' }).expect(200);
    const pid = proj.body.id as string;
    const docWithContacts = documentWithContacts('B-19 DPA тест');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    // Set operator info but not DPA
    await request(t.http()).patch(`/${API_PREFIX}/projects/${pid}/operator-info`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ name: 'Тест', email: 'test@example.com', purpose: 'Тест', retentionPeriod: '1 год' }).expect(200);
    // Publish without DPA → DPA_REQUIRED
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/DPA_REQUIRED/);
  });

  it('B-19/PL-23: operatorInfo с именем но без email → OPERATOR_INFO_REQUIRED', async () => {
    if (!t) return;
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 partial' }).expect(200);
    const pid = proj.body.id as string;
    const docWithContacts = documentWithContacts('B-19 partial');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    // Set partial operator info (name present, email missing)
    await db.db.update(schema.projects).set({ operatorInfo: { name: 'Тест', purpose: 'Тест', retentionPeriod: '1 год' } }).where(eq(schema.projects.id, pid));
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/OPERATOR_INFO_REQUIRED/);
  });

  it('B-19/PL-23: operatorInfo без имени → OPERATOR_INFO_REQUIRED', async () => {
    if (!t) return;
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 noname' }).expect(200);
    const pid = proj.body.id as string;
    const docWithContacts = documentWithContacts('B-19 noname');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    await db.db.update(schema.projects).set({ operatorInfo: { email: 'x@x.com', purpose: 'Тест', retentionPeriod: '1 год' } }).where(eq(schema.projects.id, pid));
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/OPERATOR_INFO_REQUIRED/);
  });

  it('B-19/PL-23: operatorInfo без purpose → OPERATOR_INFO_REQUIRED', async () => {
    if (!t) return;
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 nopurpose' }).expect(200);
    const pid = proj.body.id as string;
    const docWithContacts = documentWithContacts('B-19 nopurpose');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    await db.db.update(schema.projects).set({ operatorInfo: { name: 'Тест', email: 'x@x.com', retentionPeriod: '1 год' } }).where(eq(schema.projects.id, pid));
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/OPERATOR_INFO_REQUIRED/);
  });

  it('B-19/PL-23: operatorInfo без retentionPeriod → OPERATOR_INFO_REQUIRED', async () => {
    if (!t) return;
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 noretention' }).expect(200);
    const pid = proj.body.id as string;
    const docWithContacts = documentWithContacts('B-19 noretention');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    await db.db.update(schema.projects).set({ operatorInfo: { name: 'Тест', email: 'x@x.com', purpose: 'Тест' } }).where(eq(schema.projects.id, pid));
    const res = await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/OPERATOR_INFO_REQUIRED/);
  });

  it('B-19/PL-23: проект с B-19 + полный operatorInfo + DPA успешно публикуется', async () => {
    if (!t) return;
    const proj = await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ title: 'B-19 success' }).expect(200);
    const pid = proj.body.id as string;
    const docWithContacts = documentWithContacts('B-19 success');
    await db.db.update(schema.projectVersions).set({ document: docWithContacts }).where(eq(schema.projectVersions.projectId, pid));
    await request(t.http()).patch(`/${API_PREFIX}/projects/${pid}/operator-info`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ name: 'Тест', email: 'ok@ok.com', purpose: 'Тест', retentionPeriod: '1 год' }).expect(200);
    await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/dpa-accept`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(200);
    await request(t.http()).post(`/${API_PREFIX}/projects/${pid}/status`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').send({ status: 'PUBLISHED' }).expect(200);
  });

  it('PL-23: GET operator-info чужого проекта → 403', async () => {
    if (!t) return;
    const cookie2 = await loginFn();
    const res = await request(t.http()).get(`/${API_PREFIX}/projects/${projectId}/operator-info`).set('Cookie', cookie2).expect(403);
    expect(res.status).toBe(403);
  });

  it('PL-23: PATCH operator-info чужого проекта → 403', async () => {
    if (!t) return;
    const cookie2 = await loginFn();
    await request(t.http()).patch(`/${API_PREFIX}/projects/${projectId}/operator-info`).set('Cookie', cookie2).set('X-Blokum-CSRF', '1').send({ name: 'X', email: 'x@x.com', purpose: 'x', retentionPeriod: '1' }).expect(403);
  });
});
