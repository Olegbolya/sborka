import { createHash, randomInt } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import {
  type AnswerValue,
  FlowError,
  type FlowState,
  computeResult,
  navigate,
  correctOptionIds,
  createRng,
  finalFeedback,
  hasKey,
  isAnswered,
  isCorrect,
  isQuestion,
  looksLikeCardNumber,
  normalizeAnswer,
  questionScore,
  scoreTotals,
  startFlow,
} from '@blokum/engine';
import { type Block, type ProjectDocument, walkBlocks } from '@blokum/schema';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);
const gone = (): HttpException => fail(404, 'UNAVAILABLE', 'Недоступно');

const MAX_STATE_BYTES = 64 * 1024;
const SESSION_ID = /^[a-z0-9]{16}$/;

/** What the engine needs from a session: its pinned version of the document and the answers given so far. */
interface Loaded {
  session: typeof schema.participantSessions.$inferSelect;
  doc: ProjectDocument;
  ownerId: string;
}

/** The answers of a session as the engine reads them. */
type Answers = Record<string, AnswerValue>;

/** PL-11…PL-15 · a passage on the server: resume, answers (checked and idempotent), feedback, the end with the result. */
@Injectable()
export class PlaySessionsService {
  private readonly windows = new Map<string, number[]>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** The session id is the participant's capability: unguessable, kept by the browser. */
  private async load(sessionId: string): Promise<Loaded> {
    if (!SESSION_ID.test(sessionId)) throw gone();
    const [row] = await this.db
      .select({ session: schema.participantSessions, document: schema.projectVersions.document, ownerId: schema.projects.ownerId, status: schema.projects.status, moderation: schema.projects.moderationStatus, deletedAt: schema.projects.deletedAt })
      .from(schema.participantSessions)
      .innerJoin(schema.projectVersions, eq(schema.projectVersions.id, schema.participantSessions.versionId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.participantSessions.projectId))
      .where(eq(schema.participantSessions.id, sessionId));
    if (!row || row.deletedAt || row.status !== 'PUBLISHED' || row.moderation === 'BLOCKED') throw gone();
    return { session: row.session, doc: row.document as unknown as ProjectDocument, ownerId: row.ownerId };
  }

  private throttle(sessionId: string, now = Date.now()): void {
    const limit = this.config.playLimits?.answersPerMinutePerSession ?? 240;
    const recent = (this.windows.get(sessionId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= limit) throw fail(429, 'TOO_MANY_REQUESTS', 'Слишком часто. Подождите немного.');
    recent.push(now);
    this.windows.set(sessionId, recent);
  }

  private async answersOf(sessionId: string): Promise<Answers> {
    const rows = await this.db.select({ blockId: schema.answers.blockId, value: schema.answers.value }).from(schema.answers).where(and(eq(schema.answers.sessionId, sessionId), eq(schema.answers.source, 'QUESTION')));
    return Object.fromEntries(rows.filter((r) => r.blockId).map((r) => [r.blockId!, r.value as AnswerValue]));
  }

  private questionOf(doc: ProjectDocument, blockId: unknown): { block: Block; screenId: string } {
    if (typeof blockId !== 'string') throw fail(400, 'INVALID_INPUT', 'Не указан вопрос');
    for (const s of doc.screens) for (const b of walkBlocks(s.blocks)) if (b.id === blockId) {
      if (!isQuestion(b)) throw fail(422, 'NOT_A_QUESTION', 'Этот блок не принимает ответы');
      return { block: b, screenId: s.id };
    }
    throw fail(422, 'UNKNOWN_BLOCK', 'Такого вопроса нет');
  }

  /** PL-11 · the saved place of a passage and its answers, after a reload. */
  async resume(sessionId: string): Promise<{ sessionId: string; projectId: string; status: string; versionId: string; runtimeState: Record<string, unknown> | null; answers: Answers; singleAttempt: boolean }> {
    const { session } = await this.load(sessionId);
    const [project] = await this.db.select({ settings: schema.projects.settings }).from(schema.projects).where(eq(schema.projects.id, session.projectId));
    const singleAttempt = Boolean(((project?.settings ?? {}) as { singleAttempt?: boolean }).singleAttempt);
    return { sessionId, projectId: session.projectId, status: session.status, versionId: session.versionId, runtimeState: session.runtimeState ?? null, answers: await this.answersOf(sessionId), singleAttempt };
  }

  /**
   * PL-12, PL-13 · one answer: checked against the question (PL-15: the key is the server's), a card number is refused
   * and never stored (TS-10), a repeat of the same event changes nothing and an older event never overwrites a newer.
   */
  async answer(sessionId: string, body: { blockId?: unknown; value?: unknown; clientEventId?: unknown; clientTs?: unknown; timeOnScreenMs?: unknown }): Promise<{ stored: boolean; answer: AnswerValue }> {
    this.throttle(sessionId);
    const { session, doc } = await this.load(sessionId);
    if (session.status !== 'IN_PROGRESS') throw fail(409, 'SESSION_FINISHED', 'Прохождение уже завершено.');
    const { block, screenId } = this.questionOf(doc, body.blockId);
    if (typeof body.clientEventId !== 'string' || body.clientEventId.length < 6 || body.clientEventId.length > 64) throw fail(400, 'INVALID_INPUT', 'Нет номера события');
    if (typeof body.value !== 'object' || body.value === null) throw fail(400, 'INVALID_INPUT', 'Нет ответа');
    const clientTs = typeof body.clientTs === 'number' && Number.isFinite(body.clientTs) ? Math.round(body.clientTs) : Date.now();
    let answer: AnswerValue;
    try {
      answer = normalizeAnswer(block as Parameters<typeof normalizeAnswer>[0], body.value as AnswerValue);
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      if (e.code === 'CARD_LIKE') {
        // The answer is dropped; the creator gets a flag (TS-10), the text itself is not kept anywhere.
        await this.db.insert(schema.playEvents).values({ sessionId, type: 'ACTION', payload: { kind: 'CARD_LIKE_REJECTED', blockId: block.id } });
      }
      throw fail(422, e.code, e.message);
    }
    const instant = doc.settings.feedbackMode === 'instant' && hasKey(block);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'session:' + sessionId}))`);
      const [again] = await tx.select({ id: schema.answers.id }).from(schema.answers).where(and(eq(schema.answers.sessionId, sessionId), eq(schema.answers.clientEventId, body.clientEventId as string)));
      if (again) return { stored: false, answer };
      const [existing] = await tx.select().from(schema.answers).where(and(eq(schema.answers.sessionId, sessionId), eq(schema.answers.blockId, block.id)));
      if (existing) {
        // «Сразу»: an answer to a question with a key is final.
        if (instant && isAnswered(existing.value as AnswerValue)) throw fail(409, 'ANSWER_LOCKED', 'Ответ уже засчитан — изменить его нельзя.');
        if ((existing.clientTs ?? 0) > clientTs) return { stored: false, answer: existing.value as AnswerValue };
        await tx
          .update(schema.answers)
          .set({ value: answer, screenId, clientEventId: body.clientEventId as string, clientTs, answeredAt: new Date(), timeOnScreenMs: typeof body.timeOnScreenMs === 'number' ? Math.max(0, Math.round(body.timeOnScreenMs)) : null })
          .where(eq(schema.answers.id, existing.id));
      } else {
        await tx.insert(schema.answers).values({ sessionId, screenId, blockId: block.id, source: 'QUESTION', value: answer, clientEventId: body.clientEventId as string, clientTs, timeOnScreenMs: typeof body.timeOnScreenMs === 'number' ? Math.max(0, Math.round(body.timeOnScreenMs)) : null });
      }
      await tx.update(schema.participantSessions).set({ lastActivityAt: new Date() }).where(eq(schema.participantSessions.id, sessionId));
      return { stored: true, answer };
    });
  }

  /**
   * L-03, PL-15 · feedback for one answered question («сразу»): whether it is right, which options are right, the points.
   * The key leaves the server only after the participant has answered, and only in the mode that shows it.
   */
  async check(sessionId: string, blockId: unknown): Promise<{ blockId: string; correct: boolean | null; correctOptionIds: string[]; score: number }> {
    this.throttle(sessionId);
    const { doc } = await this.load(sessionId);
    if (doc.settings.feedbackMode !== 'instant') throw fail(409, 'FEEDBACK_NOT_INSTANT', 'Здесь верность ответов показывается не сразу.');
    const { block } = this.questionOf(doc, blockId);
    const answers = await this.answersOf(sessionId);
    const answer = answers[block.id];
    if (!answer || !isAnswered(answer) || !hasKey(block)) throw fail(409, 'NOT_ANSWERED', 'Сначала нужно ответить.');
    return { blockId: block.id, correct: isCorrect(block, answer), correctOptionIds: correctOptionIds(block), score: questionScore(block, answer) };
  }

  /** PL-11 · the place of the passage and the variables of scenarios, to continue after a reload. */
  async saveState(sessionId: string, state: unknown): Promise<{ saved: true }> {
    this.throttle(sessionId);
    const { session } = await this.load(sessionId);
    if (session.status !== 'IN_PROGRESS') throw fail(409, 'SESSION_FINISHED', 'Прохождение уже завершено.');
    if (typeof state !== 'object' || state === null || Array.isArray(state)) throw fail(400, 'INVALID_INPUT', 'Неверное состояние');
    if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) throw fail(413, 'STATE_TOO_LARGE', 'Состояние слишком большое.');
    // Only what resuming needs; the result and the totals are the server's and are never taken from here.
    const { screenId, history, variables } = state as Record<string, unknown>;
    const kept = { ...(typeof screenId === 'string' ? { screenId } : {}), ...(Array.isArray(history) ? { history: history.filter((h): h is string => typeof h === 'string').slice(-200) } : {}), ...(variables && typeof variables === 'object' ? { variables } : {}) };
    await this.db
      .update(schema.participantSessions)
      .set({ runtimeState: { ...(session.runtimeState ?? {}), ...kept }, lastActivityAt: new Date() })
      .where(eq(schema.participantSessions.id, sessionId));
    return { saved: true };
  }

  /**
   * PL-15 · the end: the points, the right answers and the result are worked out here by the same engine, from the answers the
   * server holds. Repeating the call returns the same result and counts the completion once.
   */
  async complete(sessionId: string): Promise<{ score: number; max: number; correct: number; keyed: number; result: { key: string; screenId: string | null } | null; feedback: Array<{ blockId: string; correct: boolean | null; correctOptionIds: string[]; score: number }> }> {
    this.throttle(sessionId);
    const { session, doc } = await this.load(sessionId);
    const answers = await this.answersOf(sessionId);
    const variables = ((session.runtimeState ?? {}) as { variables?: Record<string, never> }).variables ?? {};
    const seed = createHash('sha256').update(sessionId).digest().readUInt32BE(0);
    const totals = scoreTotals(doc, answers);
    const computed = computeResult(doc, totals, { doc, answers, variables: { ...startFlow(doc, 0).variables, ...variables }, rng: createRng(seed), random: await this.resultRandom(sessionId) });
    // No rule fits: a screen of kind «результат» that no rule points at is the result «по ветке» (L-04).
    const fallback = doc.screens.find((s) => s.kind === 'result' && !doc.results.some((r) => r.screenId === s.id));
    const result = computed ?? (fallback ? { ruleId: null, key: fallback.name, screenId: fallback.id } : null);
    const base = startFlow(doc, session.startedAt.getTime());
    const state: FlowState = { ...base, answers, finished: true, result: result ? { ruleId: result.ruleId, key: result.key, screenId: result.screenId } : null };
    const feedback = finalFeedback(doc, state);
    const now = new Date();
    if (session.status === 'IN_PROGRESS') {
      await this.db.transaction(async (tx) => {
        const done = await tx
          .update(schema.participantSessions)
          .set({ status: 'COMPLETED', completedAt: now, lastActivityAt: now, score: totals.score, resultKey: result?.key ?? null, durationMs: Math.max(0, now.getTime() - session.startedAt.getTime()), runtimeState: { ...(session.runtimeState ?? {}), result: result ?? null } })
          .where(and(eq(schema.participantSessions.id, sessionId), eq(schema.participantSessions.status, 'IN_PROGRESS')))
          .returning({ id: schema.participantSessions.id });
        if (done.length === 0) return;
        await tx
          .insert(schema.limitCounters)
          .values({ projectId: session.projectId, kind: 'COMPLETIONS', value: 1 })
          .onConflictDoUpdate({ target: [schema.limitCounters.projectId, schema.limitCounters.kind], set: { value: sql`${schema.limitCounters.value} + 1` } });
      });
    }
    return { score: totals.score, max: totals.max, correct: totals.correct, keyed: totals.keyed, result: result ? { key: result.key, screenId: result.screenId } : null, feedback };
  }

  /**
   * L-02, PL-15 · the branch of a screen decided here when its conditions read the answer key (correct, points): the screen to go
   * to, `null` for the end. The key never reaches the browser; the answers are the server's.
   */
  async branch(sessionId: string, screenId: unknown): Promise<{ to: string | null }> {
    this.throttle(sessionId);
    const { session, doc } = await this.load(sessionId);
    if (session.status !== 'IN_PROGRESS') throw fail(409, 'SESSION_FINISHED', 'Прохождение уже завершено.');
    if (typeof screenId !== 'string' || !doc.screens.some((s) => s.id === screenId)) throw fail(422, 'UNKNOWN_SCREEN', 'Такого экрана нет');
    const answers = await this.answersOf(sessionId);
    const saved = (session.runtimeState ?? {}) as { variables?: Record<string, never>; history?: string[] };
    const seed = createHash('sha256').update(`${sessionId}:${screenId}`).digest().readUInt32BE(0);
    const base = startFlow(doc, session.startedAt.getTime());
    const state: FlowState = { ...base, screenId, history: saved.history ?? [], answers, variables: { ...base.variables, ...(saved.variables ?? {}) } };
    // Required questions were checked in the browser, where it is known which of them are on show; here only the branches are read.
    const nav = navigate(doc, state, { to: 'branch' }, { now: Date.now(), rng: createRng(seed), random: await this.resultRandom(sessionId), isVisible: () => false });
    return { to: nav.to };
  }

  /**
   * RN-01 · randomness the server itself needs for the result (a tie between results, a «chance» condition that affects it):
   * 32 numbers written down once for the session, so that repeating the call gives the same outcome.
   */
  private async resultRandom(sessionId: string): Promise<{ next(): number }> {
    const SOURCE = 'result';
    const COUNT = 32;
    let rows = await this.db.select().from(schema.randomDraws).where(and(eq(schema.randomDraws.sessionId, sessionId), eq(schema.randomDraws.sourceId, SOURCE)));
    if (rows.length < COUNT) {
      await this.db
        .insert(schema.randomDraws)
        .values(Array.from({ length: COUNT }, (_x, seq) => ({ sessionId, sourceId: SOURCE, seq, outcome: { value: unit() } })))
        .onConflictDoNothing();
      rows = await this.db.select().from(schema.randomDraws).where(and(eq(schema.randomDraws.sessionId, sessionId), eq(schema.randomDraws.sourceId, SOURCE)));
    }
    const values = rows.sort((a, b) => a.seq - b.seq).map((r) => (r.outcome as { value: number }).value);
    let at = 0;
    return { next: () => values[at++ % values.length]! };
  }

  // ── RN-01 · random that affects the result ─────────────────────────────────

  /**
   * RN-01 · the draw of a wheel (the index of the sector, by weights the browser never has) or of the general stream (a float):
   * made here and written down before the animation is shown. The same request (session, source, number) gets the same outcome;
   * numbers go one after another, so nobody can ask again until a draw he does not like.
   */
  async random(sessionId: string, body: { sourceId?: unknown; seq?: unknown }): Promise<{ sourceId: string; seq: number; outcome: { index: number } | { value: number } }> {
    this.throttle(sessionId);
    const { session, doc } = await this.load(sessionId);
    if (session.status !== 'IN_PROGRESS') throw fail(409, 'SESSION_FINISHED', 'Прохождение уже завершено.');
    const sourceId = body.sourceId;
    const seq = body.seq;
    if (typeof sourceId !== 'string' || sourceId.length === 0 || sourceId.length > 64) throw fail(400, 'INVALID_INPUT', 'Не указан источник случайности');
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq >= MAX_DRAWS) throw fail(400, 'INVALID_INPUT', 'Неверный номер розыгрыша');
    let wheel: Extract<Block['behaviors'][number], { kind: 'wheel' }> | undefined;
    if (sourceId !== MAIN_STREAM) {
      for (const s of doc.screens) for (const b of walkBlocks(s.blocks)) if (b.id === sourceId) wheel = b.behaviors.find((x): x is NonNullable<typeof wheel> => x.kind === 'wheel');
      if (!wheel) throw fail(422, 'UNKNOWN_SOURCE', 'Такого колеса нет');
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'random:' + sessionId}))`);
      const [existing] = await tx.select().from(schema.randomDraws).where(and(eq(schema.randomDraws.sessionId, sessionId), eq(schema.randomDraws.sourceId, sourceId), eq(schema.randomDraws.seq, seq)));
      if (existing) return { sourceId, seq, outcome: existing.outcome as { index: number } | { value: number } };
      const [last] = await tx.select({ n: sql<number>`coalesce(max(${schema.randomDraws.seq}), -1)` }).from(schema.randomDraws).where(and(eq(schema.randomDraws.sessionId, sessionId), eq(schema.randomDraws.sourceId, sourceId)));
      if (seq > Number(last?.n ?? -1) + 1) throw fail(409, 'SEQ_GAP', 'Розыгрыши идут по порядку.');
      const outcome = wheel ? { index: drawSector(wheel.sectors.map((x) => x.weight)) } : { value: unit() };
      await tx.insert(schema.randomDraws).values({ sessionId, sourceId, seq, outcome });
      return { sourceId, seq, outcome };
    });
  }

  // ── RN-02, AC-14, VR-04 · values counted on the device ─────────────────────

  /**
   * RN-02 · values the browser reports (a score of a game, a time, moves; variables with «сохранять в ответы»; «записать в ответы»):
   * kept as «посчитано на устройстве», after checks of plausibility — the type, the range, the speed of change, the size and the
   * number. Anything that does not pass is refused whole; nothing of the request is kept.
   */
  async values(sessionId: string, body: { values?: unknown; clientTs?: unknown }): Promise<{ stored: number }> {
    this.throttle(sessionId);
    const { session, doc } = await this.load(sessionId);
    if (session.status !== 'IN_PROGRESS') throw fail(409, 'SESSION_FINISHED', 'Прохождение уже завершено.');
    if (!Array.isArray(body.values) || body.values.length === 0 || body.values.length > 50) throw fail(400, 'INVALID_INPUT', 'Не переданы значения');
    const now = typeof body.clientTs === 'number' && Number.isFinite(body.clientTs) ? Math.round(body.clientTs) : Date.now();
    const defs = new Map(doc.variables.map((v) => [v.id, v]));
    const checked: Array<{ variableId: string | null; label: string | null; value: unknown }> = [];
    for (const raw of body.values as Array<Record<string, unknown>>) {
      if (typeof raw !== 'object' || raw === null) throw fail(400, 'INVALID_INPUT', 'Неверное значение');
      const value = raw.value;
      if (typeof raw.variableId === 'string') {
        const def = defs.get(raw.variableId);
        if (!def) throw fail(422, 'UNKNOWN_VARIABLE', 'Такой переменной нет');
        checked.push({ variableId: def.id, label: null, value: this.plausible(def.type, value, def.name) });
      } else if (typeof raw.label === 'string') {
        const label = raw.label.trim();
        if (label.length === 0 || label.length > 60) throw fail(422, 'INVALID_LABEL', 'Название значения — от 1 до 60 знаков');
        if (typeof value === 'string' && value.length > 500) throw fail(422, 'VALUE_TOO_LONG', 'Значение слишком длинное');
        if (!(typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_NUMBER))) throw fail(422, 'OUT_OF_RANGE', `Значение «${label}» не подходит`);
        if (typeof value === 'string' && looksLikeCardNumber(value)) throw fail(422, 'CARD_LIKE', 'Похоже на номер карты. Никогда не вводите данные карт в опросах');
        checked.push({ variableId: null, label, value });
      } else throw fail(400, 'INVALID_INPUT', 'Не указано, что за значение');
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'values:' + sessionId}))`);
      const existing = await tx.select().from(schema.answers).where(and(eq(schema.answers.sessionId, sessionId), inArray(schema.answers.source, ['VARIABLE', 'ACTION'])));
      let labels = existing.filter((r) => r.source === 'ACTION').length;
      for (const c of checked) {
        const prev = existing.find((r) => (c.variableId ? r.variableId === c.variableId : r.source === 'ACTION' && (r.value as { label?: string }).label === c.label));
        if (c.variableId) {
          const def = defs.get(c.variableId)!;
          // The speed of change: a number cannot grow faster than a person plays.
          if (prev && def.type === 'number' && typeof c.value === 'number' && typeof prev.value === 'number') {
            const seconds = Math.max(0, (now - (prev.clientTs ?? prev.answeredAt.getTime())) / 1000);
            if (Math.abs(c.value - prev.value) > MAX_CHANGE_BASE + MAX_CHANGE_PER_SECOND * seconds) throw fail(422, 'CHANGE_TOO_FAST', `Значение «${def.name}» изменилось слишком быстро`);
          }
          if (prev) await tx.update(schema.answers).set({ value: c.value, clientTs: now, answeredAt: new Date(), deviceReported: true }).where(eq(schema.answers.id, prev.id));
          else await tx.insert(schema.answers).values({ sessionId, variableId: c.variableId, source: 'VARIABLE', value: c.value, deviceReported: true, clientTs: now });
        } else {
          const payload = { label: c.label, value: c.value };
          if (prev) await tx.update(schema.answers).set({ value: payload, clientTs: now, answeredAt: new Date() }).where(eq(schema.answers.id, prev.id));
          else {
            if (labels >= MAX_LABELS) throw fail(422, 'TOO_MANY_VALUES', 'Слишком много разных значений');
            labels++;
            await tx.insert(schema.answers).values({ sessionId, source: 'ACTION', value: payload, deviceReported: true, clientTs: now });
          }
        }
      }
      await tx.update(schema.participantSessions).set({ lastActivityAt: new Date() }).where(eq(schema.participantSessions.id, sessionId));
      return { stored: checked.length };
    });
  }

  /** The type and range of a value of a variable (VR-01); the value is returned as it will be kept. */
  private plausible(type: 'number' | 'text' | 'bool' | 'list', value: unknown, name: string): unknown {
    const bad = (message: string): never => {
      throw fail(422, 'OUT_OF_RANGE', message);
    };
    if (type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad(`Значение «${name}» — не число`);
      if (Math.abs(value) > MAX_NUMBER) return bad(`Значение «${name}» вне допустимых пределов`);
      return value;
    }
    if (type === 'bool') return typeof value === 'boolean' ? value : bad(`Значение «${name}» — не «да/нет»`);
    if (type === 'text') {
      if (typeof value !== 'string') return bad(`Значение «${name}» — не текст`);
      if (value.length > 1000) return bad(`Значение «${name}» слишком длинное`);
      if (looksLikeCardNumber(value)) throw fail(422, 'CARD_LIKE', 'Похоже на номер карты. Никогда не вводите данные карт в опросах');
      return value;
    }
    if (!Array.isArray(value) || value.length > 500 || value.some((x) => !(typeof x === 'number' ? Number.isFinite(x) : typeof x === 'string' && x.length <= 200))) return bad(`Значение «${name}» — неверный список`);
    return value;
  }
}

/** A float in [0, 1) from the system's secure source (`randomInt` takes a range up to 2^48 − 1). */
const RANGE = 2 ** 48 - 1;
const unit = (): number => randomInt(0, RANGE) / RANGE;

const MAIN_STREAM = 'main';
const MAX_DRAWS = 5000;
const MAX_NUMBER = 1_000_000_000;
/** A number reported by the device may differ from the previous report by this much, plus this much for every second between them. */
const MAX_CHANGE_BASE = 10_000;
const MAX_CHANGE_PER_SECOND = 10_000;
const MAX_LABELS = 50;

/** The sector of a wheel by its weights (all zero — any sector with the same chance). */
function drawSector(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return randomInt(0, weights.length);
  let r = unit() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}
