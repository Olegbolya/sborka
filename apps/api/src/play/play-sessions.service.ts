import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
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
    const computed = computeResult(doc, totals, { doc, answers, variables: { ...startFlow(doc, 0).variables, ...variables }, rng: createRng(seed), random: createRng(seed ^ 0x9e3779b9) });
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
    const nav = navigate(doc, state, { to: 'branch' }, { now: Date.now(), rng: createRng(seed), random: createRng(seed ^ 0x9e3779b9), isVisible: () => false });
    return { to: nav.to };
  }
}
