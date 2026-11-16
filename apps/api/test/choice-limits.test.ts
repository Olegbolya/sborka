import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { choiceLimitWarnings, createBlock, createId, limitedOptions, toPublicDocument, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { createTestDb, pgSkipGuard, startTestApp, type TestApp, type TestDb } from './helpers.js';

let phoneCounter = 0;
const sentCodes: { phone: string; code: string }[] = [];
const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get' | 'delete', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const open = (t: TestApp, method: 'get' | 'post', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set({ 'X-Blokum-CSRF': '1' });
  return body === undefined ? r : r.send(body as object);
};

describe('B-24, PL-24, PL-25, PL-26, D-12, B-25 · лимит выборов варианта («Занято»)', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;
  let cookie: string;

  /** A new person every time: a new account may publish only two assemblies on its first day. */
  async function login(): Promise<string> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(3000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    return ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
  }

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  interface Dinner {
    id: string;
    slug: string;
    questionId: string;
    nameId: string;
    options: string[];
    published: { warnings: string[] };
  }

  /** «Оливье» (1 место, остаток виден), «Селёдка» (2 места), «Горячее» (без лимита) + вопрос «Как вас зовут». */
  async function dinner(settings: Record<string, unknown> = {}, mutate?: (doc: ProjectDocument) => void): Promise<Dinner> {
    cookie = await login();
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Кто что несёт' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const q = createBlock('singleChoice');
    if (q.type !== 'singleChoice') throw new Error('тип');
    q.props.required = true;
    const extra = { ...structuredClone(q.children[0]!), id: createId() };
    q.children.push(extra);
    q.props.options.push({ ...q.props.options[0]!, id: createId(), blockId: extra.id });
    q.props.options[0]!.limit = 1;
    q.props.options[0]!.showRemaining = true;
    q.props.options[1]!.limit = 2;
    const name = createBlock('textInput');
    if (name.type !== 'textInput') throw new Error('тип');
    name.props.semantic = 'name';
    doc.screens[0]!.blocks.push(q, name, createBlock('button'));
    mutate?.(doc);
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    if (Object.keys(settings).length > 0) await call(t, cookie, 'patch', `/projects/${created.id}/access-settings`, settings).expect(200);
    const pub = await call(t, cookie, 'post', `/projects/${created.id}/publish`);
    if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
    const published = pub.body as { warnings: string[] };
    return { id: created.id, slug: created.slug, questionId: q.id, nameId: name.id, options: q.props.options.map((o) => o.id), published };
  }
  const start = async (id: string) => ((await open(t, 'post', `/play/${id}/sessions`, {}).expect(201)).body as { sessionId: string }).sessionId;
  const choose = (sid: string, blockId: string, optionId: string) => open(t, 'post', `/play/sessions/${sid}/answers`, { blockId, value: { kind: 'choice', optionIds: [optionId] }, clientEventId: createId(12), clientTs: Date.now() });
  const places = async (sid: string) => ((await open(t, 'get', `/play/sessions/${sid}/places`).expect(200)).body as { options: Record<string, { taken: boolean; left: number | null }> }).options;

  it('B-24 · лимит не уходит в браузер участника, у сборки без лимитов мест нет', async () => {
    const d = await dinner();
    const view = (await open(t, 'get', `/play/${d.slug}`).expect(200)).body as { document: ProjectDocument };
    expect(JSON.stringify(view.document)).not.toContain('"limit"');
    expect(JSON.stringify(view.document)).not.toContain('showRemaining');
    const [row] = await db.db.select({ doc: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, (await db.db.select({ v: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, d.id)))[0]!.v!));
    const full = row!.doc as unknown as ProjectDocument;
    expect(limitedOptions(full).map((o) => [o.optionId, o.limit, o.showRemaining])).toEqual([[d.options[0], 1, true], [d.options[1], 2, false]]);
    expect(JSON.stringify(toPublicDocument(full))).not.toContain('"limit"');
  });

  it('PL-24 · два параллельных прохождения выбирают последнее место: сохраняется один ответ, второй получает «занято» и выбирает другой', async () => {
    const d = await dinner();
    const [a, b] = await Promise.all([start(d.id), start(d.id)]);
    const [ra, rb] = await Promise.all([choose(a, d.questionId, d.options[0]!), choose(b, d.questionId, d.options[0]!)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    const loserSession = ra.status === 409 ? a : b;
    const body = loser.body as { error: { code: string; message: string; takenOptionIds: string[] } };
    expect(body.error).toEqual({ code: 'OPTION_TAKEN', message: 'Этот вариант только что заняли — выберите другой.', takenOptionIds: [d.options[0]] });
    const stored = await db.db.select().from(schema.answers).where(eq(schema.answers.blockId, d.questionId));
    expect(stored).toHaveLength(1);
    // Проигравший может выбрать другой вариант.
    await choose(loserSession, d.questionId, d.options[1]!).expect(200);
  });

  it('PL-24 · сто попыток занять 2 места: ровно 2 удачных', async () => {
    const d = await dinner();
    const sessions = await Promise.all(Array.from({ length: 12 }, () => start(d.id)));
    const results = await Promise.all(sessions.map((s) => choose(s, d.questionId, d.options[1]!)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(10);
  });

  it('PL-25 · плеер получает занятость: свой выбор не «занят», чужой — занят; остаток виден только если создатель разрешил', async () => {
    const d = await dinner();
    const a = await start(d.id);
    const b = await start(d.id);
    expect(await places(b)).toEqual({ [d.options[0]!]: { taken: false, left: 1 }, [d.options[1]!]: { taken: false, left: null } });
    await choose(a, d.questionId, d.options[0]!).expect(200);
    expect(await places(a)).toEqual({ [d.options[0]!]: { taken: false, left: 0 }, [d.options[1]!]: { taken: false, left: null } });
    expect(await places(b)).toEqual({ [d.options[0]!]: { taken: true, left: 0 }, [d.options[1]!]: { taken: false, left: null } });
    await open(t, 'get', '/play/sessions/нет-такой/places').expect(404);
  });

  it('PL-26 · незавершённое прохождение освобождает место через заданное число часов; завершённое держит его', async () => {
    const d = await dinner({}, (doc) => void (doc.settings.choiceHoldHours = 2));
    const a = await start(d.id);
    const b = await start(d.id);
    await choose(a, d.questionId, d.options[0]!).expect(200);
    await choose(b, d.questionId, d.options[0]!).expect(409);
    // Прошло 3 часа без действий — место свободно.
    await db.db.update(schema.participantSessions).set({ lastActivityAt: new Date(Date.now() - 3 * 3_600_000) }).where(eq(schema.participantSessions.id, a));
    expect((await places(b))[d.options[0]!]!.taken).toBe(false);
    await choose(b, d.questionId, d.options[0]!).expect(200);
    // Прохождение a, вернувшееся позже, место уже не получит.
    await open(t, 'post', `/play/sessions/${a}/complete`, {}).expect(409);
    // Завершённое держит место, сколько бы времени ни прошло.
    await open(t, 'post', `/play/sessions/${b}/complete`, {}).expect(200);
    await db.db.update(schema.participantSessions).set({ lastActivityAt: new Date(Date.now() - 100 * 3_600_000), startedAt: new Date(Date.now() - 100 * 3_600_000) }).where(eq(schema.participantSessions.id, b));
    const c = await start(d.id);
    expect((await places(c))[d.options[0]!]!.taken).toBe(true);
  });

  it('D-12 · кабинет видит, кто занял вариант; удаление прохождения и ручное освобождение возвращают место', async () => {
    const d = await dinner();
    const a = await start(d.id);
    const b = await start(d.id);
    await open(t, 'post', `/play/sessions/${a}/answers`, { blockId: d.nameId, value: { kind: 'text', value: 'Тётя Таня' }, clientEventId: createId(12), clientTs: Date.now() }).expect(200);
    await choose(a, d.questionId, d.options[0]!).expect(200);
    const view = (await call(t, cookie, 'get', `/projects/${d.id}/choice-limits`).expect(200)).body as { holdHours: number; places: Array<{ optionId: string; limit: number; used: number; holders: Array<{ sessionId: string; who: string | null }> }> };
    expect(view.holdHours).toBe(24);
    const first = view.places.find((p) => p.optionId === d.options[0])!;
    expect(first).toMatchObject({ limit: 1, used: 1 });
    expect(first.holders).toMatchObject([{ sessionId: a, who: 'Тётя Таня' }]);
    // Чужой кабинет закрыт.
    await call(t, '', 'get', `/projects/${d.id}/choice-limits`).expect(401);
    // Ручное освобождение: место снова свободно, ответ остался в таблице.
    await choose(b, d.questionId, d.options[0]!).expect(409);
    await call(t, cookie, 'post', `/projects/${d.id}/choice-limits/release`, { sessionId: a, optionId: d.options[0] }).expect(204);
    await choose(b, d.questionId, d.options[0]!).expect(200);
    expect(await db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, a))).toHaveLength(2);
    // Удаление прохождения (D-04) тоже освобождает.
    await db.db.delete(schema.participantSessions).where(eq(schema.participantSessions.id, b));
    const c = await start(d.id);
    await choose(c, d.questionId, d.options[0]!).expect(200);
    await call(t, cookie, 'post', `/projects/${d.id}/choice-limits/release`, { sessionId: 'net-takogo', optionId: d.options[0] }).expect(404);
  });

  it('B-25 · предупреждение при публикации: у обязательного вопроса мест меньше, чем прохождений; без нехватки предупреждения нет', async () => {
    const few = await dinner({ maxCompletions: 10 }, (doc) => {
      const q = doc.screens[0]!.blocks.find((b) => b.type === 'singleChoice');
      if (q?.type !== 'singleChoice') throw new Error('нет вопроса');
      q.props.options.forEach((o) => void (o.limit = 2));
    });
    expect(few.published.warnings).toHaveLength(1);
    expect(few.published.warnings[0]).toContain('всего 6 мест');
    const enough = await dinner({ maxCompletions: 3 }, (doc) => {
      const q = doc.screens[0]!.blocks.find((b) => b.type === 'singleChoice');
      if (q?.type !== 'singleChoice') throw new Error('нет вопроса');
      q.props.options.forEach((o) => void (o.limit = 2));
    });
    expect(enough.published.warnings).toEqual([]);
    // Есть вариант без лимита — мест хватит всегда.
    expect((await dinner({ maxCompletions: 500 })).published.warnings).toEqual([]);
    expect(choiceLimitWarnings({ screens: [] }, 5)).toEqual([]);
    expect(choiceLimitWarnings({ screens: [] }, undefined)).toEqual([]);
  });
});
