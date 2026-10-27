import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;

/** Создать приложение с перехватом OTP-кодов и вернуть helper для входа. */
async function makeAppWithAuth(): Promise<{ t: TestApp; db: TestDb; loginViaOtp: (phone?: string) => Promise<string> }> {
  const db = await createTestDb();
  const sentCodes: { phone: string; code: string }[] = [];
  const otpSender: OtpSender = {
    sendCode: vi.fn((phone: string, code: string) => {
      sentCodes.push({ phone, code });
      return Promise.resolve();
    }),
  };
  const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
  const t = await startTestApp({ db: db.db, otpSender, captchaVerifier });

  async function loginViaOtp(phone?: string): Promise<string> {
    // Clear rate-limit state between logins
    await db.db.delete(schema.otpRequests);
    const p = phone ?? `+7900${String(1000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/request`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, captchaToken: 'ok' })
      .expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/auth/otp/verify`)
      .set('X-Blokum-CSRF', '1')
      .send({ phone: p, code })
      .expect(200);
    const cookies = (res.headers['set-cookie'] ?? []) as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('session='));
    if (!sessionCookie) throw new Error('Нет session cookie');
    return sessionCookie.split(';')[0]!;
  }

  return { t, db, loginViaOtp };
}

import { createDocument, createBlock, type ProjectDocument } from '@blokum/schema';

interface Loaded {
  draftVersionNumber: number;
  document: ProjectDocument;
}
import { SNAPSHOTS_KEPT, parseIfMatch } from '../src/projects/drafts.service.js';

describe('E-17…E-19 · Черновик, версии, конфликты', () => {
  let t: TestApp;
  let db: TestDb;
  let loginViaOtp: (phone?: string) => Promise<string>;
  let cookie: string;

  beforeAll(async () => {
    ({ t, db, loginViaOtp } = await makeAppWithAuth());
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });
  beforeEach(async () => {
    cookie = await loginViaOtp();
  });

  const create = async (c = cookie): Promise<{ id: string; draftVersionNumber: number; document: ProjectDocument }> =>
    (await request(t.http()).post(`/${API_PREFIX}/projects`).set('Cookie', c).set('X-Blokum-CSRF', '1').send({ title: 'Черновик' }).expect(200)).body as { id: string; draftVersionNumber: number; document: ProjectDocument };
  const put = (id: string, revision: string | number | undefined, document: unknown, c = cookie) => {
    const r = request(t.http()).put(`/${API_PREFIX}/projects/${id}/draft`).set('Cookie', c).set('X-Blokum-CSRF', '1');
    if (revision !== undefined) r.set('If-Match', String(revision));
    return r.send({ document });
  };
  const withBlock = (doc: ProjectDocument, text: string): ProjectDocument => {
    const copy = structuredClone(doc);
    copy.screens[0]!.blocks.push(createBlock('text', { name: text }));
    return copy;
  };

  it('E-17 · сохранение с текущей версией: версия растёт, правка видна при загрузке', async () => {
    const p = await create();
    const doc = withBlock(p.document, 'Первый');
    const res = await put(p.id, p.draftVersionNumber, doc).expect(200);
    expect(res.body.revision).toBeGreaterThan(p.draftVersionNumber);
    const loaded = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}`).set('Cookie', cookie).expect(200)).body as Loaded;
    expect(loaded.draftVersionNumber).toBe(res.body.revision);
    expect(loaded.document.screens[0]!.blocks[0]!.name).toBe('Первый');
  });

  it('E-17 · название сборки в документе обновляет название в списке', async () => {
    const p = await create();
    const doc = structuredClone(p.document);
    doc.meta.title = 'Новое имя';
    await put(p.id, p.draftVersionNumber, doc).expect(200);
    const list = (await request(t.http()).get(`/${API_PREFIX}/projects`).set('Cookie', cookie).expect(200)).body as Array<{ id: string; title: string }>;
    expect(list.find((x) => x.id === p.id)?.title).toBe('Новое имя');
  });

  it('E-18 · устаревшая версия → 409 со ссылкой на текущую, чужая правка не затёрта', async () => {
    const p = await create();
    const first = await put(p.id, p.draftVersionNumber, withBlock(p.document, 'Вкладка A')).expect(200);
    const stale = await put(p.id, p.draftVersionNumber, withBlock(p.document, 'Вкладка B')).expect(409);
    expect(stale.body.error).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: first.body.revision });
    const loaded = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}`).set('Cookie', cookie)).body as Loaded;
    expect(loaded.document.screens[0]!.blocks.map((b) => b.name)).toEqual(['Вкладка A']);
  });

  it('E-18 · If-Match: * перезаписывает, кавычки и W/ допускаются', async () => {
    const p = await create();
    const a = await put(p.id, p.draftVersionNumber, withBlock(p.document, 'A')).expect(200);
    await put(p.id, '*', withBlock(p.document, 'B')).expect(200);
    const b = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}`).set('Cookie', cookie)).body as Loaded;
    expect(b.document.screens[0]!.blocks[0]!.name).toBe('B');
    await put(p.id, `W/"${b.draftVersionNumber}"`, withBlock(p.document, 'C')).expect(200);
    expect(a.body.revision).toBeLessThan(b.draftVersionNumber);
  });

  it('E-18 · без If-Match → 428, с мусором → 400', async () => {
    const p = await create();
    const none = await put(p.id, undefined, p.document).expect(428);
    expect(none.body.error.code).toBe('REVISION_REQUIRED');
    const junk = await put(p.id, 'abc', p.document).expect(400);
    expect(junk.body.error.code).toBe('INVALID_REVISION');
  });

  it('E-17 · документ, не прошедший проверку схемы, отклоняется по-русски и не меняет черновик', async () => {
    const p = await create();
    const bad = { ...p.document, screens: [] };
    const res = await put(p.id, p.draftVersionNumber, bad).expect(400);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT');
    expect(res.body.error.message).toMatch(/^Сборка не прошла проверку: /);
    await put(p.id, p.draftVersionNumber, undefined).expect(400);
    const loaded = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}`).set('Cookie', cookie)).body as Loaded;
    expect(loaded.draftVersionNumber).toBe(p.draftVersionNumber);
  });

  it('E-17 · чужую сборку сохранить нельзя (403), несуществующую — 404', async () => {
    const p = await create();
    const other = await loginViaOtp();
    await put(p.id, p.draftVersionNumber, p.document, other).expect(403);
    await put('net-takoj', 1, p.document).expect(404);
    await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions`).set('Cookie', other).expect(403);
    await request(t.http()).post(`/${API_PREFIX}/projects/${p.id}/restore/x`).set('Cookie', other).set('X-Blokum-CSRF', '1').expect(403);
  });

  it('E-17 · без входа → 401', async () => {
    const p = await create();
    await request(t.http()).put(`/${API_PREFIX}/projects/${p.id}/draft`).set('X-Blokum-CSRF', '1').set('If-Match', '1').send({ document: p.document }).expect(401);
  });

  it('E-19 · первая правка делает снимок прежнего черновика; частые правки новых снимков не плодят', async () => {
    const p = await create();
    let rev = p.draftVersionNumber;
    for (const name of ['1', '2', '3']) rev = (await put(p.id, rev, withBlock(p.document, name)).expect(200)).body.revision;
    const versions = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions`).set('Cookie', cookie).expect(200)).body as Array<{ id: string; kind: string }>;
    expect(versions).toHaveLength(1);
    expect(versions[0]!.kind).toBe('DRAFT_SNAPSHOT');
    const snap = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions/${versions[0]!.id}`).set('Cookie', cookie).expect(200)).body as { document: ProjectDocument };
    expect(snap.document.screens[0]!.blocks).toHaveLength(0);
  });

  it('E-19 · восстановление: черновик становится версией, заменённый черновик сохраняется снимком', async () => {
    const p = await create();
    const rev = (await put(p.id, p.draftVersionNumber, withBlock(p.document, 'Новое')).expect(200)).body.revision as number;
    const [old] = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions`).set('Cookie', cookie)).body as Array<{ id: string }>;
    const res = (await request(t.http()).post(`/${API_PREFIX}/projects/${p.id}/restore/${old!.id}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(200)).body as { revision: number; document: ProjectDocument };
    expect(res.revision).toBeGreaterThan(rev);
    expect(res.document.screens[0]!.blocks).toHaveLength(0);
    const loaded = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}`).set('Cookie', cookie)).body as Loaded;
    expect(loaded.document.screens[0]!.blocks).toHaveLength(0);
    const versions = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions`).set('Cookie', cookie)).body as Array<{ id: string }>;
    const names = await Promise.all(
      versions.map(async (v) => (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions/${v.id}`).set('Cookie', cookie)).body.document.screens[0].blocks.length as number),
    );
    expect(names).toContain(1);
  });

  it('E-19 · несуществующая версия и чужая версия → 404', async () => {
    const p = await create();
    const q = await create();
    await put(q.id, q.draftVersionNumber, withBlock(q.document, 'x')).expect(200);
    const [foreign] = (await request(t.http()).get(`/${API_PREFIX}/projects/${q.id}/versions`).set('Cookie', cookie)).body as Array<{ id: string }>;
    await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions/${foreign!.id}`).set('Cookie', cookie).expect(404);
    await request(t.http()).post(`/${API_PREFIX}/projects/${p.id}/restore/${foreign!.id}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(404);
    const draftId = (await db.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)))[0]!.draftVersionId!;
    await request(t.http()).post(`/${API_PREFIX}/projects/${p.id}/restore/${draftId}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1').expect(404);
  });

  it('E-19 · хранится не больше SNAPSHOTS_KEPT снимков', async () => {
    const p = await create();
    await put(p.id, p.draftVersionNumber, withBlock(p.document, 'x')).expect(200);
    const [snap] = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions`).set('Cookie', cookie)).body as Array<{ id: string }>;
    for (let i = 0; i < SNAPSHOTS_KEPT + 3; i++) {
      await request(t.http()).post(`/${API_PREFIX}/projects/${p.id}/restore/${snap!.id}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
    }
    const versions = (await request(t.http()).get(`/${API_PREFIX}/projects/${p.id}/versions`).set('Cookie', cookie)).body as unknown[];
    expect(versions.length).toBeLessThanOrEqual(SNAPSHOTS_KEPT);
  }, 60_000);

  it('E-17 · документ до 3 МБ проходит (лимит тела запроса выше стандартного)', async () => {
    const p = await create();
    const doc = createDocument({ title: 'Большая' });
    for (let i = 0; i < 40; i++) {
      const b = createBlock('text', { name: `Блок ${i}`, textLayer: { paragraphs: [{ runs: [{ t: 'я'.repeat(4000) }] }] } });
      doc.screens[0]!.blocks.push(b);
    }
    expect(JSON.stringify(doc).length).toBeGreaterThan(150_000);
    await put(p.id, p.draftVersionNumber, doc).expect(200);
  });
});

describe('E-18 · разбор If-Match', () => {
  it('число, число в кавычках, слабый тег, звёздочка', () => {
    expect(parseIfMatch('7')).toBe(7);
    expect(parseIfMatch('"7"')).toBe(7);
    expect(parseIfMatch('W/"7"')).toBe(7);
    expect(parseIfMatch(' * ')).toBe('*');
  });
  it('пусто, ноль, дробь, текст — ошибка', () => {
    for (const bad of [undefined, '', '0', '1.5', 'abc']) expect(() => parseIfMatch(bad)).toThrow();
  });
});
