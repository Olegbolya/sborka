import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { createBlock, createId, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import { FeatureFlagsService } from '../src/admin/feature-flags.service.js';
import { RetentionService } from '../src/admin/retention.service.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

const DAY = 86_400_000;
const sent: { phone: string; code: string }[] = [];

describe('P8.9 · режим ОРИ (05-LEGAL §2.6): выключен по умолчанию, журнал фактов передачи сообщений, сроки', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let cookie: string;
  let ownerId: string;

  const call = (method: 'post' | 'put', url: string, body?: unknown) => {
    const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    return body === undefined ? r : r.send(body as object);
  };
  const open = (url: string, body: unknown) => request(t.http()).post(`/${API_PREFIX}${url}`).set('X-Blokum-CSRF', '1').send(body as object);

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sent.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
      const phone = '+79041234567';
      await open('/auth/otp/request', { phone, captchaToken: 'ok' }).expect(200);
      const res = await open('/auth/otp/verify', { phone, code: sent.pop()!.code }).expect(200);
      cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
      ownerId = (await db.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phoneE164, phone)))[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  async function project() {
    // На бесплатном тарифе опубликованных сборок немного — прежние закрываем.
    await db.db.update(schema.projects).set({ status: 'CLOSED' }).where(eq(schema.projects.ownerId, ownerId));
    const created = (await call('post', '/projects', { title: 'Опрос' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    const q = createBlock('textInput');
    created.document.screens[0]!.blocks.push(q, createBlock('button'));
    await call('put', `/projects/${created.id}/draft`, { document: created.document }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call('post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, block: q.id };
  }
  const passage = async (id: string, block: string, text: string) => {
    const sid = ((await open(`/play/${id}/sessions`, {}).expect(201)).body as { sessionId: string }).sessionId;
    await open(`/play/sessions/${sid}/answers`, { blockId: block, value: { kind: 'text', value: text }, clientEventId: createId(12), clientTs: Date.now() }).expect(200);
    return sid;
  };
  const logRows = () => db.db.select().from(schema.commsMetaLog);

  it('P8.9 · по умолчанию режим выключен, журнал не пишется', async () => {
    const flags = t.app.get(FeatureFlagsService);
    expect(await flags.isEnabled('ORI_MODE')).toBe(false);
    const p = await project();
    await passage(p.id, p.block, 'привет');
    expect(await logRows()).toHaveLength(0);
    const view = (await flags.list()).find((f) => f.key === 'ORI_MODE');
    expect(view).toMatchObject({ enabled: false, usual: false });
    expect((await flags.list()).find((f) => f.key === 'PLAYER_ENABLED')).toMatchObject({ enabled: true, usual: true });
  });

  it('P8.9 · включённый режим пишет факт каждого ответа: кому, откуда, сколько байт, срок содержания 6 месяцев', async () => {
    await t.app.get(FeatureFlagsService).set('ORI_MODE', true, 'решение владельца после консультации', ownerId);
    const p = await project();
    const before = Date.now();
    const sid = await passage(p.id, p.block, 'второй ответ');
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'ANSWER', projectId: p.id, recipientId: ownerId, sessionId: sid });
    expect(rows[0]!.bytes).toBeGreaterThan(5);
    expect(rows[0]!.contentUntil.getTime() - before).toBeGreaterThan(182 * DAY);
    expect(JSON.stringify(rows[0])).not.toContain('второй ответ'); // в журнале нет содержания
    expect(await t.app.get(RetentionService).commsMeta({ projectId: p.id })).toHaveLength(1);
    expect(await t.app.get(RetentionService).commsMeta({ recipientId: 'нет-такого' })).toHaveLength(0);
  });

  it('P8.9 · пока режим включён, ответы лежат не меньше 6 месяцев; без режима — по тарифу', async () => {
    const svc = t.app.get(RetentionService);
    const flags = t.app.get(FeatureFlagsService);
    const p = await project();
    const sid = await passage(p.id, p.block, 'срок');
    const exists = async () => (await db.db.select({ id: schema.participantSessions.id }).from(schema.participantSessions).where(eq(schema.participantSessions.id, sid))).length === 1;
    const in60 = new Date(Date.now() + 60 * DAY); // бесплатный тариф хранит 30 дней
    await svc.run(in60);
    expect(await exists()).toBe(true); // режим ОРИ включён
    await flags.set('ORI_MODE', false, '', ownerId);
    await svc.run(in60);
    expect(await exists()).toBe(false);
  });

  it('P8.9 · сведения о передаче сообщений хранятся 3 года и после выключения режима; уничтожение записывается в журнал', async () => {
    const svc = t.app.get(RetentionService);
    expect((await logRows()).length).toBeGreaterThan(0);
    await svc.run(new Date(Date.now() + 2 * 365 * DAY));
    expect((await logRows()).length).toBeGreaterThan(0);
    const done = await svc.run(new Date(Date.now() + 4 * 365 * DAY));
    expect(done.find((d) => d.kind === 'ORI_META')?.count).toBeGreaterThan(0);
    expect(await logRows()).toHaveLength(0);
    expect((await svc.journal(100)).some((j) => j.kind === 'ORI_META')).toBe(true);
  });
});
