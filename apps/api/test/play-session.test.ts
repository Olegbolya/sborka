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

import { createBlock, createId, createScreen, type ProjectDocument } from '@blokum/schema';

const call = (t: TestApp, cookie: string, method: 'post' | 'put' | 'patch' | 'get', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set('Cookie', cookie).set('X-Blokum-CSRF', '1');
  return body === undefined ? r : r.send(body as object);
};
const open = (t: TestApp, method: 'get' | 'post' | 'put', url: string, body?: unknown) => {
  const r = request(t.http())[method](`/${API_PREFIX}${url}`).set({ 'X-Blokum-CSRF': '1' });
  return body === undefined ? r : r.send(body as object);
};

interface Quiz {
  id: string;
  slug: string;
  q1: { id: string; optionIds: string[] };
  q2: { id: string; optionIds: string[] };
  text: string;
  resultScreen: string;
}

describe('PL-11…PL-15 · прохождение на сервере', () => {
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

  /** A quiz: two questions with a key (7 and 5 points), a text question, two result screens chosen by points. */
  async function quiz(feedbackMode: 'instant' | 'end' | 'none' = 'instant'): Promise<Quiz> {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Викторина' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const make = (points: number) => {
      const q = createBlock('singleChoice');
      if (q.type !== 'singleChoice') throw new Error('тип');
      q.props.options[0]!.correct = true;
      q.props.options[0]!.score = points;
      q.props.options[1]!.score = 0;
      return q;
    };
    const q1 = make(7);
    const q2 = make(5);
    const text = createBlock('textInput');
    const low = createScreen('Мало');
    low.kind = 'result';
    const high = createScreen('Много');
    high.kind = 'result';
    doc.screens[0]!.blocks.push(q1, q2, text, createBlock('button'));
    doc.screens.push(low, high);
    doc.settings.feedbackMode = feedbackMode;
    doc.results = [
      { kind: 'scoreRange', id: createId(), key: 'Эксперт', screenId: high.id, min: 10, max: 100 },
      { kind: 'scoreRange', id: createId(), key: 'Новичок', screenId: low.id, min: 0, max: 9 },
    ];
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    const ids = (q: typeof q1) => (q.type === 'singleChoice' ? q.props.options.map((o) => o.id) : []);
    return { id: created.id, slug: created.slug, q1: { id: q1.id, optionIds: ids(q1) }, q2: { id: q2.id, optionIds: ids(q2) }, text: text.id, resultScreen: high.id };
  }
  const startSession = async (id: string) => ((await open(t, 'post', `/play/${id}/sessions`, {}).expect(201)).body as { sessionId: string }).sessionId;
  const answer = (sid: string, blockId: string, value: unknown, extra: Record<string, unknown> = {}) => open(t, 'post', `/play/sessions/${sid}/answers`, { blockId, value, clientEventId: createId(12), clientTs: Date.now(), ...extra });
  const rowsOf = (sid: string) => db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, sid));

  it('PL-13 · ответ проверяется по вопросу: чужой вариант, лишние варианты, не вопрос и неизвестный блок отклоняются по-русски', async () => {
    const z = await quiz();
    const sid = await startSession(z.id);
    const bad = await answer(sid, z.q1.id, { kind: 'choice', optionIds: ['net-takogo'] }).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_ANSWER', message: 'Такого варианта ответа нет' });
    await answer(sid, z.q1.id, { kind: 'choice', optionIds: z.q1.optionIds }).expect(422);
    await answer(sid, z.q1.id, { kind: 'text', value: 'ответ' }).expect(422);
    await answer(sid, 'netakogo_bloka', { kind: 'text', value: 'x' }).expect(422);
    expect(await rowsOf(sid)).toHaveLength(0);
  });

  it('PL-12, PL-14 · ответ сохраняется один раз: повтор события — без изменений, старое событие не затирает новое, время на экране пишется', async () => {
    const z = await quiz('none');
    const sid = await startSession(z.id);
    const first = await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[1]!] }, { clientEventId: 'sobytie-001', clientTs: 2000, timeOnScreenMs: 4200 }).expect(200);
    expect(first.body.stored).toBe(true);
    const repeat = await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[1]!] }, { clientEventId: 'sobytie-001', clientTs: 2000 }).expect(200);
    expect(repeat.body.stored).toBe(false);
    const stale = await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }, { clientEventId: 'sobytie-000', clientTs: 1000 }).expect(200);
    expect(stale.body.stored).toBe(false);
    let [row] = await rowsOf(sid);
    expect(row).toMatchObject({ value: { kind: 'choice', optionIds: [z.q1.optionIds[1]] }, timeOnScreenMs: 4200, source: 'QUESTION' });
    await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }, { clientEventId: 'sobytie-002', clientTs: 3000 }).expect(200);
    [row] = await rowsOf(sid);
    expect(row!.value).toEqual({ kind: 'choice', optionIds: [z.q1.optionIds[0]] });
    expect(await rowsOf(sid)).toHaveLength(1);
  });

  it('TS-10, PL-13 · номер карты в ответе отклоняется и не сохраняется нигде; создателю остаётся флаг', async () => {
    const z = await quiz();
    const sid = await startSession(z.id);
    for (const value of ['4111 1111 1111 1111', '4111-1111-1111-1111', 'карта 4111111111111111']) {
      const res = await answer(sid, z.text, { kind: 'text', value }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'CARD_LIKE', message: 'Похоже на номер карты. Никогда не вводите данные карт в опросах' });
    }
    await answer(sid, z.text, { kind: 'text', value: '4111 1111 1111 1112' }).expect(200);
    const stored = JSON.stringify(await db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, sid)));
    expect(stored).not.toContain('4111 1111 1111 1111');
    expect(stored).not.toContain('4111111111111111');
    const events = await db.db.select().from(schema.playEvents).where(eq(schema.playEvents.sessionId, sid));
    expect(events.filter((e) => (e.payload as { kind?: string }).kind === 'CARD_LIKE_REJECTED')).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('4111');
  });

  it('L-03, PL-15 · «сразу»: ключ выдаётся только после ответа; ответ на вопрос с ключом нельзя изменить', async () => {
    const z = await quiz('instant');
    const sid = await startSession(z.id);
    await open(t, 'post', `/play/sessions/${sid}/check`, { blockId: z.q1.id }).expect(409);
    const given = await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[1]!] }).expect(200);
    expect(JSON.stringify(given.body)).not.toMatch(/correct|score/);
    const check = (await open(t, 'post', `/play/sessions/${sid}/check`, { blockId: z.q1.id }).expect(200)).body;
    expect(check).toEqual({ blockId: z.q1.id, correct: false, correctOptionIds: [z.q1.optionIds[0]], score: 0 });
    const again = await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }).expect(409);
    expect(again.body.error.code).toBe('ANSWER_LOCKED');
  });

  it('L-03 · режимы «в конце» и «не показывать»: проверка по ходу недоступна', async () => {
    for (const mode of ['end', 'none'] as const) {
      const z = await quiz(mode);
      const sid = await startSession(z.id);
      await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }).expect(200);
      await open(t, 'post', `/play/sessions/${sid}/check`, { blockId: z.q1.id }).expect(409);
      // «В конце» ответ можно менять до конца.
      await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[1]!] }).expect(200);
    }
  });

  it('PL-15 · итог считает сервер: баллы, правильные, результат по диапазону; повтор не считает завершение дважды; после конца ответы не принимаются', async () => {
    const z = await quiz('end');
    const high = await startSession(z.id);
    await answer(high, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }).expect(200);
    await answer(high, z.q2.id, { kind: 'choice', optionIds: [z.q2.optionIds[0]!] }).expect(200);
    const done = (await open(t, 'post', `/play/sessions/${high}/complete`).expect(200)).body;
    expect(done).toMatchObject({ score: 12, max: 12, correct: 2, keyed: 2, result: { key: 'Эксперт', screenId: z.resultScreen } });
    expect(done.feedback).toHaveLength(2);
    expect((await open(t, 'post', `/play/sessions/${high}/complete`).expect(200)).body).toEqual(done);
    const [row] = await db.db.select().from(schema.participantSessions).where(eq(schema.participantSessions.id, high));
    expect(row).toMatchObject({ status: 'COMPLETED', score: 12, resultKey: 'Эксперт' });
    expect(row!.completedAt).toBeTruthy();
    const counters = await db.db.select().from(schema.limitCounters).where(eq(schema.limitCounters.projectId, z.id));
    expect(counters.find((c) => c.kind === 'COMPLETIONS')?.value).toBe(1);
    const late = await answer(high, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[1]!] }).expect(409);
    expect(late.body.error.code).toBe('SESSION_FINISHED');

    const low = await startSession(z.id);
    await answer(low, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[1]!] }).expect(200);
    await answer(low, z.q2.id, { kind: 'choice', optionIds: [z.q2.optionIds[0]!] }).expect(200);
    const lowDone = (await open(t, 'post', `/play/sessions/${low}/complete`).expect(200)).body;
    expect(lowDone).toMatchObject({ score: 5, result: { key: 'Новичок' } });
  });

  it('PL-15 · «не показывать»: итог без разбора по вопросам', async () => {
    const z = await quiz('none');
    const sid = await startSession(z.id);
    await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }).expect(200);
    const done = (await open(t, 'post', `/play/sessions/${sid}/complete`).expect(200)).body;
    expect(done.feedback).toEqual([]);
  });

  it('PL-11 · продолжение: место, переменные и ответы возвращаются; сессия остаётся на своей версии после новой публикации', async () => {
    const z = await quiz('none');
    const sid = await startSession(z.id);
    await answer(sid, z.q1.id, { kind: 'choice', optionIds: [z.q1.optionIds[0]!] }).expect(200);
    await open(t, 'put', `/play/sessions/${sid}/state`, { screenId: 'ekran', history: ['a', 'b'], variables: { ochki: 3 }, score: 999, result: 'подмена' }).expect(200);
    // Новая публикация с другим названием.
    const project = (await call(t, cookie, 'get', `/projects/${z.id}`).expect(200)).body as { document: ProjectDocument; draftVersionNumber: number };
    project.document.meta.title = 'Новое название';
    await call(t, cookie, 'put', `/projects/${z.id}/draft`, { document: project.document }).set('If-Match', String(project.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${z.id}/publish`).expect(200);
    const resumed = (await open(t, 'get', `/play/sessions/${sid}`).expect(200)).body;
    expect(resumed).toMatchObject({ status: 'IN_PROGRESS', runtimeState: { screenId: 'ekran', history: ['a', 'b'], variables: { ochki: 3 } }, view: { state: 'ok', title: 'Викторина' } });
    expect(resumed.runtimeState.score).toBeUndefined();
    expect(resumed.runtimeState.result).toBeUndefined();
    expect(resumed.answers[z.q1.id]).toEqual({ kind: 'choice', optionIds: [z.q1.optionIds[0]] });
    expect(JSON.stringify(resumed.view)).not.toMatch(/"correct"|"score"|resultTags/);
    await open(t, 'get', '/play/sessions/netakogo123456').expect(404);
    await open(t, 'put', `/play/sessions/${sid}/state`, { variables: { big: 'x'.repeat(70_000) } }).expect(413);
  });

  it('TS-13 · частота стартов по хэшу адреса ограничена; адрес не хранится, в сессии — только хэш', async () => {
    // Earlier tests of this file started passages from the same address: the limit is set three above what is already counted.
    const z = await quiz();
    const already = (await db.db.select().from(schema.participantSessions)).length;
    const limited = await startTestApp({ db: db.db }, { playLimits: { startsPerHourPerIp: already + 3, answersPerMinutePerSession: 5 } });
    try {
      const startOn = () => request(limited.http()).post(`/${API_PREFIX}/play/${z.id}/sessions`).set('X-Blokum-CSRF', '1').send({});
      for (let i = 0; i < 3; i++) await startOn().expect(201);
      const res = await startOn().expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
      const rows = await db.db.select().from(schema.participantSessions).where(eq(schema.participantSessions.projectId, z.id));
      expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.ipHash ?? ''))).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
      // Ответы: не больше пяти в минуту на сессию.
      const sid = rows[0]!.id;
      const send = () => request(limited.http()).post(`/${API_PREFIX}/play/sessions/${sid}/answers`).set('X-Blokum-CSRF', '1').send({ blockId: z.text, value: { kind: 'text', value: 'привет' }, clientEventId: createId(12) });
      for (let i = 0; i < 5; i++) await send().expect(200);
      await send().expect(429);
    } finally {
      await limited.app.close();
    }
  });

  it('L-02, PL-15 · ветка по баллам решается на сервере: «баллы за вопрос ≥ 7» ведёт на нужный экран, иначе — дальше', async () => {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Ветка' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const q = createBlock('singleChoice');
    if (q.type !== 'singleChoice') throw new Error('тип');
    q.props.options[0]!.correct = true;
    q.props.options[0]!.score = 7;
    const middle = createScreen('Середина');
    const far = createScreen('Далеко');
    doc.screens[0]!.blocks.push(q, createBlock('button'));
    doc.screens[0]!.branches = [{ id: createId(), if: { kind: 'answer', questionBlockId: q.id, op: 'scoreGte', value: 7 }, to: { kind: 'screen', screenId: far.id } }];
    middle.blocks.push(createBlock('button'));
    doc.screens.push(middle, far);
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    const hit = await startSession(created.id);
    await answer(hit, q.id, { kind: 'choice', optionIds: [q.props.options[0]!.id] }).expect(200);
    expect((await open(t, 'post', `/play/sessions/${hit}/branch`, { screenId: doc.screens[0]!.id }).expect(200)).body).toEqual({ to: far.id });
    const miss = await startSession(created.id);
    await answer(miss, q.id, { kind: 'choice', optionIds: [q.props.options[1]!.id] }).expect(200);
    expect((await open(t, 'post', `/play/sessions/${miss}/branch`, { screenId: doc.screens[0]!.id }).expect(200)).body).toEqual({ to: middle.id });
    await open(t, 'post', `/play/sessions/${miss}/branch`, { screenId: 'netakogo' }).expect(422);
  });

  /** A project with a wheel (weights as given), a number variable and a text variable. */
  async function game(weights: number[] = [0, 0, 1]): Promise<{ id: string; wheel: string }> {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Игра' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const wheel = createBlock('container', {
      id: createId(),
            children: weights.map((_w, i) => createBlock('shape', { name: `Сектор ${i}` })),
    });
    // The sectors of the wheel are its children: their ids go into the behavior.
    const kids = wheel.children.map((c) => c.id);
    wheel.behaviors = [{ kind: 'wheel', spinMs: 2000, sectors: weights.map((weight, i) => ({ blockId: kids[i]!, weight })) }];
    doc.variables.push({ id: 'ochki_var', name: 'очки', type: 'number', initial: 0, saveToAnswers: true }, { id: 'imya_var', name: 'имя', type: 'text', initial: '', saveToAnswers: false });
    doc.screens[0]!.blocks.push(wheel, createBlock('button'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    return { id: created.id, wheel: wheel.id };
  }
  const draw = (sid: string, sourceId: string, seq: number) => open(t, 'post', `/play/sessions/${sid}/random`, { sourceId, seq });

  it('RN-01 · колесо разыгрывает сервер по весам, которых у браузера нет; повтор запроса даёт тот же исход; розыгрыши идут по порядку', async () => {
    const g = await game([0, 0, 1]);
    const sid = await startSession(g.id);
    const first = (await draw(sid, g.wheel, 0).expect(200)).body;
    expect(first).toMatchObject({ sourceId: g.wheel, seq: 0, outcome: { index: 2 } });
    expect((await draw(sid, g.wheel, 0).expect(200)).body).toEqual(first);
    await draw(sid, g.wheel, 5).expect(409);
    expect((await draw(sid, g.wheel, 1).expect(200)).body.outcome).toEqual({ index: 2 });
    const rows = await db.db.select().from(schema.randomDraws).where(eq(schema.randomDraws.sessionId, sid));
    expect(rows.map((r) => r.seq).sort()).toEqual([0, 1]);
    await draw(sid, 'netakogo_kolesa', 0).expect(422);
    const stream = (await draw(sid, 'main', 0).expect(200)).body.outcome.value as number;
    expect(stream).toBeGreaterThanOrEqual(0);
    expect(stream).toBeLessThan(1);
    const view = (await open(t, 'get', `/play/${(await call(t, cookie, 'get', `/projects/${g.id}`).expect(200)).body.slug as string}`).expect(200)).body;
    expect(JSON.stringify(view)).not.toContain('"weight"');
  });

  it('RN-01 · доли выпадений близки к весам', async () => {
    const g = await game([1, 3]);
    const sid = await startSession(g.id);
    let second = 0;
    const N = 300;
    for (let seq = 0; seq < N; seq++) {
      const res = (await draw(sid, g.wheel, seq).expect(200)).body as { outcome: { index: number } };
      if (res.outcome.index === 1) second++;
    }
    expect(second / N).toBeGreaterThan(0.65);
    expect(second / N).toBeLessThan(0.85);
  }, 60_000);

  it('RN-02 · значения с устройства: переменные и «записать в ответы» хранятся с пометкой «посчитано на устройстве»', async () => {
    const g = await game();
    const sid = await startSession(g.id);
    await open(t, 'post', `/play/sessions/${sid}/values`, { values: [{ variableId: 'ochki_var', value: 120 }, { label: 'Приз', value: 'Билет' }, { label: 'Ходы', value: 14 }], clientTs: 10_000 }).expect(200);
    const rows = await db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, sid));
    const byKey = Object.fromEntries(rows.map((r) => [r.variableId ?? (r.value as { label: string }).label, r]));
    expect(byKey.ochki_var).toMatchObject({ source: 'VARIABLE', value: 120, deviceReported: true });
    expect(byKey['Приз']).toMatchObject({ source: 'ACTION', value: { label: 'Приз', value: 'Билет' }, deviceReported: true });
    // Повтор обновляет, а не множит.
    await open(t, 'post', `/play/sessions/${sid}/values`, { values: [{ variableId: 'ochki_var', value: 150 }, { label: 'Приз', value: 'Книга' }], clientTs: 12_000 }).expect(200);
    const again = await db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, sid));
    expect(again).toHaveLength(3);
    expect(again.find((r) => r.variableId === 'ochki_var')!.value).toBe(150);
    // В кабинете видно, что значение посчитано на устройстве.
    const detail = (await call(t, cookie, 'get', `/projects/${g.id}/responses/${sid}`).expect(200)).body as { answers: Array<{ variableId: string | null; deviceReported: boolean }> };
    expect(detail.answers.find((a) => a.variableId === 'ochki_var')!.deviceReported).toBe(true);
  });

  it('RN-02 · значение вне допустимого отклоняется целиком: не тот тип, вне диапазона, слишком быстрый рост, номер карты, лишние названия', async () => {
    const g = await game();
    const sid = await startSession(g.id);
    const send = (values: unknown[], clientTs = 1000) => open(t, 'post', `/play/sessions/${sid}/values`, { values, clientTs });
    expect((await send([{ variableId: 'ochki_var', value: 'много' }]).expect(422)).body.error.code).toBe('OUT_OF_RANGE');
    expect((await send([{ variableId: 'ochki_var', value: 5e12 }]).expect(422)).body.error.code).toBe('OUT_OF_RANGE');
    expect((await send([{ variableId: 'ochki_var', value: Number.MAX_VALUE * 10 }]).expect(422)).body.error.code).toBe('OUT_OF_RANGE');
    expect((await send([{ variableId: 'netakoj_var', value: 1 }]).expect(422)).body.error.code).toBe('UNKNOWN_VARIABLE');
    expect((await send([{ variableId: 'imya_var', value: '4111 1111 1111 1111' }]).expect(422)).body.error.code).toBe('CARD_LIKE');
    expect((await send([{ label: 'Карта', value: '4111111111111111' }]).expect(422)).body.error.code).toBe('CARD_LIKE');
    await send([{ variableId: 'ochki_var', value: 100 }], 1000).expect(200);
    const fast = await send([{ variableId: 'ochki_var', value: 9_000_000 }, { label: 'Лишнее', value: 1 }], 2000).expect(422);
    expect(fast.body.error.code).toBe('CHANGE_TOO_FAST');
    // Целиком: «лишнего» тоже нет.
    const rows = await db.db.select().from(schema.answers).where(eq(schema.answers.sessionId, sid));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(100);
    for (let i = 0; i < 50; i++) await send([{ label: `Значение ${i}`, value: i }]).expect(200);
    expect((await send([{ label: 'Ещё одно', value: 1 }]).expect(422)).body.error.code).toBe('TOO_MANY_VALUES');
    await send([]).expect(400);
  });

  it('RN-01 · ничья в личностном тесте при «выбирать случайно» разыгрывается на сервере и записывается; повтор завершения даёт тот же итог', async () => {
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Ничья' }).expect(200)).body as { id: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const q = createBlock('singleChoice');
    if (q.type !== 'singleChoice') throw new Error('тип');
    q.props.options[0]!.resultTags = ['лиса'];
    q.props.options[1]!.resultTags = ['сова'];
    const a = createScreen('Лиса');
    a.kind = 'result';
    const b = createScreen('Сова');
    b.kind = 'result';
    doc.screens[0]!.blocks.push(q, createBlock('button'));
    doc.screens.push(a, b);
    doc.settings.tieBreak = 'random';
    doc.results = [
      { kind: 'tag', id: createId(), key: 'Лиса', screenId: a.id, tag: 'лиса' },
      { kind: 'tag', id: createId(), key: 'Сова', screenId: b.id, tag: 'сова' },
    ];
    // Один вопрос с множественным выбором нужен для ничьей: берём два варианта сразу.
    const multi = createBlock('multiChoice');
    if (multi.type !== 'multiChoice') throw new Error('тип');
    multi.props.options[0]!.resultTags = ['лиса'];
    multi.props.options[1]!.resultTags = ['сова'];
    doc.screens[0]!.blocks = [multi, createBlock('button')];
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    await call(t, cookie, 'post', `/projects/${created.id}/publish`).expect(200);
    const outcomes = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const sid = await startSession(created.id);
      await answer(sid, multi.id, { kind: 'choice', optionIds: [multi.props.options[0]!.id, multi.props.options[1]!.id] }).expect(200);
      const done = (await open(t, 'post', `/play/sessions/${sid}/complete`).expect(200)).body;
      expect((await open(t, 'post', `/play/sessions/${sid}/complete`).expect(200)).body).toEqual(done);
      outcomes.add(done.result.key as string);
      const draws = await db.db.select().from(schema.randomDraws).where(eq(schema.randomDraws.sessionId, sid));
      expect(draws.length).toBe(32);
    }
    expect([...outcomes].sort()).toEqual(['Лиса', 'Сова']);
  }, 90_000);
});

