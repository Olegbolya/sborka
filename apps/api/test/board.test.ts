import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import { createBlock, createId, type ProjectDocument } from '@blokum/schema';
import { API_PREFIX } from '../src/app.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { BoardService } from '../src/board/board.service.js';
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

interface Row {
  rank: number;
  name: string;
  value: number;
  count: number;
}
interface PublicBoard {
  title: string;
  groupBy: string;
  frozen: boolean;
  total: number;
  rows: Row[];
  theme: unknown;
}

describe('D-13…D-21 · табло: итоги прохождений на большом экране', () => {
  const pg = pgSkipGuard();
  let t: TestApp;
  let db: TestDb;

  async function login(): Promise<{ cookie: string; id: string }> {
    await db.db.delete(schema.otpRequests);
    const phone = `+7900${String(5000000 + ++phoneCounter).slice(-7)}`;
    await request(t.http()).post(`/${API_PREFIX}/auth/otp/request`).set('X-Blokum-CSRF', '1').send({ phone, captchaToken: 'ok' }).expect(200);
    const { code } = sentCodes.pop()!;
    const res = await request(t.http()).post(`/${API_PREFIX}/auth/otp/verify`).set('X-Blokum-CSRF', '1').send({ phone, code }).expect(200);
    const cookie = ((res.headers['set-cookie'] ?? []) as string[]).find((c) => c.startsWith('session='))!.split(';')[0]!;
    const me = (await call(t, cookie, 'get', '/auth/account').expect(200)).body as { id: string };
    return { cookie, id: me.id };
  }
  const subscribe = (userId: string, planCode: string) =>
    db.db.insert(schema.subscriptions).values({ userId, planCode, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });

  beforeAll(async () => {
    try {
      db = await createTestDb();
      const otpSender: OtpSender = { sendCode: vi.fn((phone: string, code: string) => (sentCodes.push({ phone, code }), Promise.resolve())) };
      const captchaVerifier: CaptchaVerifier = { verify: () => Promise.resolve(true) };
      t = await startTestApp({ db: db.db, otpSender, captchaVerifier }, { phoneLogin: true });
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  interface Game {
    cookie: string;
    ownerId: string;
    id: string;
    slug: string;
    teamId: string;
    teams: string[];
    quizId: string;
    quizOptions: string[];
    nickId: string;
    consentId: string;
  }

  /** Команда (Бухгалтерия / Айтишники), вопрос с баллами 10 / 4 / 1, имя, согласие «показывать моё имя». */
  async function game(plan: 'PRO' | null = 'PRO'): Promise<Game> {
    const { cookie, id: ownerId } = await login();
    if (plan) await subscribe(ownerId, plan);
    const created = (await call(t, cookie, 'post', '/projects', { title: 'Корпоратив' }).expect(200)).body as { id: string; slug: string; document: ProjectDocument; draftVersionNumber: number };
    const doc = created.document;
    const team = createBlock('singleChoice');
    const quiz = createBlock('singleChoice');
    if (team.type !== 'singleChoice' || quiz.type !== 'singleChoice') throw new Error('тип');
    const label = (q: typeof team, i: number, text: string) => {
      const child = q.children.find((c) => c.id === q.props.options[i]!.blockId)!;
      child.textLayer = { paragraphs: [{ kind: 'p', runs: [{ t: text }] }] };
    };
    label(team, 0, 'Бухгалтерия');
    label(team, 1, 'Айтишники');
    team.name = 'Команда';
    quiz.name = 'Вопрос';
    const scores = [10, 4];
    quiz.props.options.forEach((o, i) => {
      o.score = scores[i]!;
      o.correct = i === 0;
    });
    const third = { ...structuredClone(quiz.children[0]!), id: createId() };
    quiz.children.push(third);
    quiz.props.options.push({ ...quiz.props.options[0]!, id: createId(), blockId: third.id, score: 1, correct: false });
    const nick = createBlock('textInput');
    const consent = createBlock('consent');
    if (nick.type !== 'textInput' || consent.type !== 'consent') throw new Error('тип');
    doc.variables.push({ id: 'ochki_var', name: 'очки', type: 'number', initial: 0, saveToAnswers: true });
    nick.name = 'Имя для табло';
    consent.name = 'Показывать моё имя на табло';
    doc.screens[0]!.blocks.push(team, quiz, nick, consent, createBlock('button'));
    await call(t, cookie, 'put', `/projects/${created.id}/draft`, { document: doc }).set('If-Match', String(created.draftVersionNumber)).expect(200);
    const pub = await call(t, cookie, 'post', `/projects/${created.id}/publish`);
    if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
    return { cookie, ownerId, id: created.id, slug: created.slug, teamId: team.id, teams: team.props.options.map((o) => o.id), quizId: quiz.id, quizOptions: quiz.props.options.map((o) => o.id), nickId: nick.id, consentId: consent.id };
  }

  const answer = (sid: string, blockId: string, value: unknown) => open(t, 'post', `/play/sessions/${sid}/answers`, { blockId, value, clientEventId: createId(12), clientTs: Date.now() }).expect(200);

  /** A passage: a team, a quiz option, and (optionally) a name with or without the consent; `finish: false` leaves it unfinished. */
  async function pass(g: Game, o: { team?: number; quiz: number; nick?: string; agree?: boolean; finish?: boolean; points?: number }): Promise<{ sid: string; board: { place: number | null; total: number } | null }> {
    const sid = ((await open(t, 'post', `/play/${g.id}/sessions`, {}).expect(201)).body as { sessionId: string }).sessionId;
    if (o.team !== undefined) await answer(sid, g.teamId, { kind: 'choice', optionIds: [g.teams[o.team]!] });
    await answer(sid, g.quizId, { kind: 'choice', optionIds: [g.quizOptions[o.quiz]!] });
    if (o.nick !== undefined) await answer(sid, g.nickId, { kind: 'text', value: o.nick });
    if (o.agree !== undefined) await answer(sid, g.consentId, { kind: 'consent', value: o.agree });
    if (o.points !== undefined) await open(t, 'post', `/play/sessions/${sid}/values`, { values: [{ variableId: 'ochki_var', value: o.points }], clientTs: Date.now() }).expect(200);
    if (o.finish === false) return { sid, board: null };
    const done = (await open(t, 'post', `/play/sessions/${sid}/complete`, {}).expect(200)).body as { board: { place: number | null; total: number } | null };
    return { sid, board: done.board };
  }

  const settings = (g: Game, extra: Record<string, unknown>) => call(t, g.cookie, 'put', `/projects/${g.id}/board`, { enabled: true, ...extra });
  const publicBoard = async (code: string) => (await open(t, 'get', `/board/${code}`).expect(200)).body as PublicBoard;
  const codeOf = async (g: Game) => ((await call(t, g.cookie, 'get', `/projects/${g.id}/board`).expect(200)).body as { code: string | null }).code!;
  /** The public answer is kept for three seconds; the tests that look again at once drop it the way a change of the creator does. */
  const fresh = async (g: Game) => {
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/hide`, { key: 'x', hidden: false }).expect(204);
    return publicBoard(await codeOf(g));
  };

  it('D-13 · BD-01 · включение даёт отдельную ссылку /b/{код}; без включения табло нет; на «Старте» включить нельзя (D-21 · BD-09)', async () => {
    const g = await game();
    const off = (await call(t, g.cookie, 'get', `/projects/${g.id}/board`).expect(200)).body as { code: string | null; settings: { enabled: boolean }; allowed: boolean };
    expect(off).toMatchObject({ code: null, allowed: true, settings: { enabled: false } });
    const on = (await settings(g, {}).expect(200)).body as { code: string; settings: { enabled: boolean } };
    expect(on.settings.enabled).toBe(true);
    expect(on.code).toMatch(/^[a-z0-9]{10}$/);
    expect(on.code).not.toContain(g.slug);
    const board = await publicBoard(on.code);
    expect(board).toMatchObject({ title: 'Корпоратив', groupBy: 'participants', frozen: false, total: 0, rows: [] });
    // Свой QR табло — на адрес /b/{код}.
    const svg = await call(t, g.cookie, 'get', `/projects/${g.id}/board/qr.svg`).expect(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    const png = await call(t, g.cookie, 'get', `/projects/${g.id}/board/qr.png`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect((png.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    // Выключили — страницы нет.
    await call(t, g.cookie, 'put', `/projects/${g.id}/board`, { enabled: false }).expect(200);
    await open(t, 'get', `/board/${on.code}`).expect(404);
    await open(t, 'get', '/board/нетТакого').expect(404);

    // BD-09: «Старт».
    const free = await game(null);
    const state = (await call(t, free.cookie, 'get', `/projects/${free.id}/board`).expect(200)).body as { allowed: boolean };
    expect(state.allowed).toBe(false);
    const refused = await settings(free, {}).expect(402);
    expect(refused.body.error.message).toBe('Табло есть на платных тарифах и с пропуском «Праздник».');
    // Чужая сборка.
    const other = await login();
    await call(t, other.cookie, 'get', `/projects/${g.id}/board`).expect(403);
    await call(t, other.cookie, 'put', `/projects/${g.id}/board`, { enabled: true }).expect(403);
  });

  it('D-14 · BD-02 · считаются только завершённые прохождения, сумма совпадает с баллами в кабинете; результат без ключа ответов', async () => {
    const g = await game();
    await settings(g, { nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    await pass(g, { quiz: 0, nick: 'Аня', agree: true });
    await pass(g, { quiz: 1, nick: 'Боря', agree: true });
    await pass(g, { quiz: 0, nick: 'Не закончила', agree: true, finish: false });
    const board = await fresh(g);
    expect(board.total).toBe(2);
    expect(board.rows.map((r) => [r.rank, r.name, r.value])).toEqual([[1, 'Аня', 10], [2, 'Боря', 4]]);
    const stored = await db.db.select({ score: schema.participantSessions.score }).from(schema.participantSessions).where(eq(schema.participantSessions.projectId, g.id));
    expect(stored.filter((s) => s.score !== null).map((s) => s.score as number).sort((a, b) => a - b)).toEqual([4, 10]);
    // Ответов и правильных вариантов в публичном ответе нет.
    const text = JSON.stringify({ ...board, theme: null });
    expect(text).not.toContain('correct');
    expect(text).not.toContain('optionIds');
    expect(text).not.toContain('"score":');
    expect(Object.keys(board).sort()).toEqual(['aggregate', 'frozen', 'groupBy', 'metric', 'metricTitle', 'rows', 'slug', 'theme', 'title', 'total', 'updatedAt']);
  });

  it('D-15 · BD-03 · команды: три прохождения двух команд дают правильные суммы, средние и число участников', async () => {
    const g = await game();
    await settings(g, { groupBy: 'teams', teamBlockId: g.teamId, aggregate: 'sum' }).expect(200);
    await pass(g, { team: 0, quiz: 0 }); // Бухгалтерия 10
    await pass(g, { team: 0, quiz: 1 }); // Бухгалтерия 4
    await pass(g, { team: 1, quiz: 0 }); // Айтишники 10
    const sum = await fresh(g);
    expect(sum.groupBy).toBe('teams');
    expect(sum.rows.map((r) => [r.rank, r.name, r.value, r.count])).toEqual([[1, 'Бухгалтерия', 14, 2], [2, 'Айтишники', 10, 1]]);
    await settings(g, { groupBy: 'teams', teamBlockId: g.teamId, aggregate: 'avg' }).expect(200);
    const avg = await fresh(g);
    expect(avg.rows.map((r) => [r.rank, r.name, r.value, r.count])).toEqual([[1, 'Айтишники', 10, 1], [2, 'Бухгалтерия', 7, 2]]);
    // Команда — вопрос сборки: чужого блока не принимаем.
    await settings(g, { groupBy: 'teams', teamBlockId: 'нет-такого' }).expect(422);
    await settings(g, { groupBy: 'teams' }).expect(422);
  });

  it('D-15 · одинаковые значения делят место (1, 2, 2, 4)', async () => {
    const g = await game();
    await settings(g, { nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    for (const [quiz, nick] of [[0, 'А'], [1, 'Б'], [1, 'В'], [2, 'Г']] as const) await pass(g, { quiz, nick, agree: true });
    const board = await fresh(g);
    expect(board.rows.map((r) => [r.rank, r.name, r.value])).toEqual([[1, 'А', 10], [2, 'Б', 4], [2, 'В', 4], [4, 'Г', 1]]);
  });

  it('D-20 · BD-08 · ник показывается только с согласием «Показывать моё имя» и без стоп-слов, иначе «Участник N»', async () => {
    await db.db.insert(schema.safetyTerms).values({ kind: 'STOP', term: 'дурак', category: 'A', weight: 90, active: true });
    // The board reads the dictionary once a minute; the test does not wait for it.
    t.app.get<{ dictionary: unknown }>(BoardService).dictionary = null;
    const g = await game();
    await settings(g, { nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    await pass(g, { quiz: 0, nick: 'Аня', agree: true });
    await pass(g, { quiz: 1, nick: 'Секретный', agree: false });
    await pass(g, { quiz: 2, nick: 'Дураки' , agree: true });
    await pass(g, { quiz: 2 });
    const board = await fresh(g);
    expect(board.rows.map((r) => r.name)).toEqual(['Аня', 'Участник 2', 'Участник 3', 'Участник 4']);
    expect(JSON.stringify(board)).not.toContain('Секретный');
    expect(JSON.stringify(board)).not.toContain('Дураки');
    // Без выбранного согласия имён нет вообще.
    await settings(g, { nickBlockId: g.nickId }).expect(200);
    expect((await fresh(g)).rows.map((r) => r.name)).toEqual(['Участник 1', 'Участник 2', 'Участник 3', 'Участник 4']);
  });

  it('D-17 · BD-05 · ответ табло кэшируется на 3 секунды: новое прохождение видно после правки создателя или через кэш', async () => {
    const g = await game();
    await settings(g, { nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    const code = await codeOf(g);
    expect((await publicBoard(code)).total).toBe(0);
    await pass(g, { quiz: 0, nick: 'Аня', agree: true });
    // Тут же — ещё прежний ответ из кэша (одно вычисление на всех зрителей).
    expect((await publicBoard(code)).total).toBe(0);
    await new Promise((r) => setTimeout(r, 3100));
    expect((await publicBoard(code)).total).toBe(1);
    expect(typeof (await publicBoard(code)).theme).toBe('object');
  });

  it('D-18 · BD-06 · {{место}} в конце прохождения совпадает с позицией на табло; кнопка «Открыть табло» приходит вместе со сборкой', async () => {
    const g = await game();
    await settings(g, { nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    const first = await pass(g, { quiz: 1, nick: 'Боря', agree: true });
    expect(first.board).toEqual({ place: 1, total: 1 });
    const second = await pass(g, { quiz: 0, nick: 'Аня', agree: true });
    expect(second.board).toEqual({ place: 1, total: 2 });
    const third = await pass(g, { quiz: 2, nick: 'Вася', agree: true });
    expect(third.board).toEqual({ place: 3, total: 3 });
    const board = await fresh(g);
    expect(board.rows.map((r) => [r.rank, r.name])).toEqual([[1, 'Аня'], [2, 'Боря'], [3, 'Вася']]);
    const view = (await open(t, 'get', `/play/${g.slug}`).expect(200)).body as { board: { code: string } | null };
    expect(view.board).toEqual({ code: await codeOf(g) });
    await settings(g, { showOnFinish: false }).expect(200);
    expect(((await open(t, 'get', `/play/${g.slug}`).expect(200)).body as { board: unknown }).board).toBeNull();
    // Команды: место — место команды.
    const t2 = await game();
    await settings(t2, { groupBy: 'teams', teamBlockId: t2.teamId }).expect(200);
    await pass(t2, { team: 0, quiz: 0 });
    const lower = await pass(t2, { team: 1, quiz: 2 });
    expect(lower.board).toEqual({ place: 2, total: 2 });
    // Сборка без табло — места нет.
    const none = await game();
    expect((await pass(none, { quiz: 0 })).board).toBeNull();
  });

  it('D-19 · BD-07 · заморозка не пускает новых, возобновление пускает; обнуление начинает новый раунд; скрытая строка не видна', async () => {
    const g = await game();
    await settings(g, { nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    const code = await codeOf(g);
    const a = await pass(g, { quiz: 0, nick: 'Аня', agree: true });
    await pass(g, { quiz: 1, nick: 'Боря', agree: true });
    expect((await fresh(g)).total).toBe(2);

    // Скрыть строку.
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/hide`, { key: a.sid, hidden: true }).expect(204);
    let board = await publicBoard(code);
    expect(board.rows.map((r) => r.name)).toEqual(['Боря']);
    expect(board.total).toBe(1);
    const mine = (await call(t, g.cookie, 'get', `/projects/${g.id}/board/rows`).expect(200)).body as { rows: Array<{ key: string; name: string; hidden: boolean }> };
    expect(mine.rows.find((r) => r.key === a.sid)).toMatchObject({ name: 'Аня', hidden: true });
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/hide`, { key: a.sid, hidden: false }).expect(204);
    expect((await publicBoard(code)).rows.map((r) => r.name)).toEqual(['Аня', 'Боря']);

    // Заморозка: то, что закончилось после, в итоги не попадает.
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/freeze`, { frozen: true }).expect(204);
    await new Promise((r) => setTimeout(r, 20));
    await pass(g, { quiz: 0, nick: 'Опоздавший', agree: true });
    board = await publicBoard(code);
    expect(board.frozen).toBe(true);
    expect(board.rows.map((r) => r.name)).toEqual(['Аня', 'Боря']);
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/freeze`, { frozen: false }).expect(204);
    expect((await publicBoard(code)).rows.map((r) => r.name)).toEqual(['Аня', 'Опоздавший', 'Боря']);

    // Обнуление: новый раунд, скрытое снова видно, старые прохождения не считаются.
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/hide`, { key: a.sid, hidden: true }).expect(204);
    await new Promise((r) => setTimeout(r, 20));
    await call(t, g.cookie, 'post', `/projects/${g.id}/board/reset`).expect(204);
    expect((await publicBoard(code)).rows).toEqual([]);
    await pass(g, { quiz: 1, nick: 'Новичок', agree: true });
    expect((await fresh(g)).rows.map((r) => r.name)).toEqual(['Новичок']);
    // Прохождения прошлых раундов остались в кабинете.
    const all = await db.db.select({ id: schema.participantSessions.id }).from(schema.participantSessions).where(eq(schema.participantSessions.projectId, g.id));
    expect(all.length).toBe(4);
    await call(t, (await login()).cookie, 'post', `/projects/${g.id}/board/reset`).expect(403);
  });

  it('D-14 · метрика — числовая переменная, сохраняемая в ответы', async () => {
    const g = await game();
    const view = (await call(t, g.cookie, 'get', `/projects/${g.id}/board`).expect(200)).body as { candidates: { variables: unknown[] } };
    expect(view.candidates.variables).toEqual([{ id: 'ochki_var', name: 'очки' }]);
    await settings(g, { metric: 'variable' }).expect(422);
    await settings(g, { metric: 'variable', metricVariableId: 'нет-такой' }).expect(422);
    await settings(g, { metric: 'variable', metricVariableId: 'ochki_var', nickBlockId: g.nickId, consentBlockId: g.consentId }).expect(200);
    await pass(g, { quiz: 0, nick: 'Аня', agree: true, points: 7 });
    await pass(g, { quiz: 2, nick: 'Боря', agree: true, points: 30 });
    await pass(g, { quiz: 1, nick: 'Вася', agree: true });
    const board = (await fresh(g)) as PublicBoard & { metricTitle: string };
    expect(board.metricTitle).toBe('очки');
    expect(board.rows.map((r) => [r.rank, r.name, r.value])).toEqual([[1, 'Боря', 30], [2, 'Аня', 7], [3, 'Вася', 0]]);
  });
});
