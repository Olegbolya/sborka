import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, lt } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { optionLabel } from '@blokum/engine';
import { type Block, type ProjectDocument, type PublicDocument, compileTerms, findTerms, toPublicDocument, walkBlocks } from '@blokum/schema';
import { SafetyService } from '../admin/safety.service.js';
import { fail } from '../admin/errors.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { type ApiConfig } from '../config.js';
import { buildSvg, DEFAULT_QR_STYLE, renderPng } from '../projects/qr-render.js';
import { API_CONFIG, DB } from '../tokens.js';

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** One computation of a board is shared by everyone who looks within this time (D-17). */
const CACHE_MS = 3000;
const CACHE_MAX = 500;
/** A board shows at most this many rows; a longer list is cut at the bottom. */
const ROWS_MAX = 200;
/** The passages of one round that are counted: more than this is far beyond a party or a class. */
const SESSIONS_MAX = 5000;

export interface BoardSettings {
  enabled: boolean;
  groupBy: 'teams' | 'participants';
  metric: 'score' | 'variable';
  metricVariableId: string | null;
  aggregate: 'sum' | 'avg';
  teamBlockId: string | null;
  nickBlockId: string | null;
  consentBlockId: string | null;
  showOnFinish: boolean;
}

export interface BoardRow {
  key: string;
  rank: number;
  name: string;
  value: number;
  /** Passages in the row: 1 for a participant, the members for a team. */
  count: number;
  hidden: boolean;
}

export interface BoardStanding {
  rows: BoardRow[];
  /** Passages that are counted (all rows together). */
  total: number;
}

export interface PublicBoard {
  title: string;
  slug: string;
  groupBy: 'teams' | 'participants';
  metric: 'score' | 'variable';
  metricTitle: string;
  aggregate: 'sum' | 'avg';
  frozen: boolean;
  total: number;
  rows: Array<Pick<BoardRow, 'rank' | 'name' | 'value' | 'count'>>;
  updatedAt: string;
  theme: PublicDocument['theme'];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** What the creator may choose from: the blocks of the document the board reads. */
export interface BoardCandidates {
  questions: Array<{ id: string; name: string; screen: string }>;
  texts: Array<{ id: string; name: string; screen: string }>;
  consents: Array<{ id: string; name: string; screen: string }>;
  variables: Array<{ id: string; name: string }>;
}

/**
 * D-13…D-21 · the board of a project: standings of finished passages on a public page, a team or a participant per row. The creator
 * switches it on, freezes it («итоги подведены»), starts a new round and hides a row; the public answer is computed once per three seconds.
 */
@Injectable()
export class BoardService {
  private readonly cache = new Map<string, { at: number; value: PublicBoard | null }>();
  private dictionary: { at: number; terms: ReturnType<typeof compileTerms> } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly entitlements?: EntitlementsService,
    @Optional() private readonly safety?: SafetyService,
    @Optional() @Inject(API_CONFIG) private readonly config?: ApiConfig,
  ) {}

  // ── The creator's side ───────────────────────────────────────────────────

  private async owned(userId: string, projectId: string) {
    const [p] = await this.db
      .select({ id: schema.projects.id, ownerId: schema.projects.ownerId, title: schema.projects.title, slug: schema.projects.slug, published: schema.projects.publishedVersionId, draft: schema.projects.draftVersionId, deletedAt: schema.projects.deletedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!p || p.deletedAt) throw fail(404, 'NOT_FOUND', 'Сборка не найдена.');
    if (p.ownerId !== userId) throw fail(403, 'FORBIDDEN', 'Это не ваша сборка.');
    return p;
  }

  private async docById(versionId: string | null): Promise<ProjectDocument | null> {
    if (!versionId) return null;
    const [v] = await this.db.select({ document: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, versionId));
    return v ? (v.document as unknown as ProjectDocument) : null;
  }

  private candidates(doc: ProjectDocument | null): BoardCandidates {
    const out: BoardCandidates = { questions: [], texts: [], consents: [], variables: [] };
    if (!doc) return out;
    for (const s of doc.screens)
      for (const b of walkBlocks(s.blocks)) {
        const item = { id: b.id, name: b.name, screen: s.name };
        if (b.type === 'singleChoice') out.questions.push(item);
        else if (b.type === 'textInput') out.texts.push(item);
        else if (b.type === 'consent') out.consents.push(item);
      }
    for (const v of doc.variables) if (v.type === 'number' && v.saveToAnswers) out.variables.push({ id: v.id, name: v.name });
    return out;
  }

  private settingsOf(row: typeof schema.boards.$inferSelect | undefined): BoardSettings {
    return {
      enabled: row?.enabled ?? false,
      groupBy: row?.groupBy === 'teams' ? 'teams' : 'participants',
      metric: row?.metric === 'variable' ? 'variable' : 'score',
      metricVariableId: row?.metricVariableId ?? null,
      aggregate: row?.aggregate === 'avg' ? 'avg' : 'sum',
      teamBlockId: row?.teamBlockId ?? null,
      nickBlockId: row?.nickBlockId ?? null,
      consentBlockId: row?.consentBlockId ?? null,
      showOnFinish: row?.showOnFinish ?? true,
    };
  }

  /** D-13 · everything the settings page needs: the settings, the address, the state of the round, what can be chosen, and whether the plan has it. */
  async get(userId: string, projectId: string) {
    const p = await this.owned(userId, projectId);
    const [row] = await this.db.select().from(schema.boards).where(eq(schema.boards.projectId, projectId));
    const doc = await this.docById(p.published ?? p.draft);
    return {
      allowed: this.entitlements ? await this.entitlements.scoreboardAllowed(userId, projectId) : true,
      settings: this.settingsOf(row),
      code: row?.code ?? null,
      frozen: Boolean(row?.frozenAt),
      frozenAt: row?.frozenAt?.toISOString() ?? null,
      resetAt: row?.resetAt?.toISOString() ?? null,
      published: Boolean(p.published),
      candidates: this.candidates(doc),
    };
  }

  /** D-13 · switch on / change: the choices must be blocks of the document, so a board never points at nothing. */
  async save(userId: string, projectId: string, body: unknown) {
    const p = await this.owned(userId, projectId);
    const b = (body ?? {}) as Record<string, unknown>;
    const enabled = b.enabled === true;
    if (enabled && this.entitlements && !(await this.entitlements.scoreboardAllowed(userId, projectId))) throw fail(402, 'PLAN_REQUIRED', 'Табло есть на платных тарифах и с пропуском «Праздник».');
    const groupBy = b.groupBy === 'teams' ? 'teams' : 'participants';
    const metric = b.metric === 'variable' ? 'variable' : 'score';
    const aggregate = b.aggregate === 'avg' ? 'avg' : 'sum';
    const id = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
    const doc = await this.docById(p.published ?? p.draft);
    const cand = this.candidates(doc);
    const has = (list: Array<{ id: string }>, v: string | null): boolean => v === null || list.some((x) => x.id === v);
    const teamBlockId = id(b.teamBlockId);
    const nickBlockId = id(b.nickBlockId);
    const consentBlockId = id(b.consentBlockId);
    const metricVariableId = id(b.metricVariableId);
    if (!has(cand.questions, teamBlockId)) throw fail(422, 'TEAM_BLOCK', 'Команда — это вопрос «Выбор одного варианта» вашей сборки.');
    if (!has(cand.texts, nickBlockId)) throw fail(422, 'NICK_BLOCK', 'Имя для табло — это текстовое поле вашей сборки.');
    if (!has(cand.consents, consentBlockId)) throw fail(422, 'CONSENT_BLOCK', 'Согласие — это блок «Согласие» вашей сборки.');
    if (!has(cand.variables, metricVariableId)) throw fail(422, 'METRIC_VARIABLE', 'Считать можно числовую переменную, которая сохраняется в ответы.');
    if (enabled && groupBy === 'teams' && !teamBlockId) throw fail(422, 'TEAM_BLOCK', 'Выберите вопрос, ответ на который — команда.');
    if (enabled && metric === 'variable' && !metricVariableId) throw fail(422, 'METRIC_VARIABLE', 'Выберите числовую переменную для подсчёта.');
    const values = { enabled, groupBy, metric, aggregate, teamBlockId, nickBlockId, consentBlockId, metricVariableId, showOnFinish: b.showOnFinish !== false };
    const [row] = await this.db.select().from(schema.boards).where(eq(schema.boards.projectId, projectId));
    if (row) await this.db.update(schema.boards).set(values).where(eq(schema.boards.projectId, projectId));
    else await this.db.insert(schema.boards).values({ projectId, code: this.newCode(), ...values });
    this.forget(row?.code);
    return this.get(userId, projectId);
  }

  private newCode(): string {
    const bytes = randomBytes(10);
    return Array.from(bytes, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  }

  private async rowOf(userId: string, projectId: string): Promise<typeof schema.boards.$inferSelect> {
    await this.owned(userId, projectId);
    const [row] = await this.db.select().from(schema.boards).where(eq(schema.boards.projectId, projectId));
    if (!row) throw fail(404, 'NO_BOARD', 'Табло не включено.');
    return row;
  }

  /** D-19 · «итоги подведены»: the board keeps what it had at that moment; «возобновить» lets later passages in again. */
  async freeze(userId: string, projectId: string, frozen: unknown): Promise<void> {
    const row = await this.rowOf(userId, projectId);
    await this.db.update(schema.boards).set({ frozenAt: frozen === true ? new Date() : null }).where(eq(schema.boards.projectId, projectId));
    this.forget(row.code);
  }

  /** D-19 · a new round: only passages that end from now on count; the hidden rows are shown again (they belonged to the old round); the freeze is lifted. */
  async reset(userId: string, projectId: string): Promise<void> {
    const row = await this.rowOf(userId, projectId);
    await this.db.transaction(async (tx) => {
      await tx.update(schema.boards).set({ resetAt: new Date(), frozenAt: null }).where(eq(schema.boards.projectId, projectId));
      await tx.delete(schema.boardHidden).where(eq(schema.boardHidden.projectId, projectId));
    });
    this.forget(row.code);
  }

  /** D-19 · hide a row (a participant or a team) from the public board, or show it again. */
  async hide(userId: string, projectId: string, rowKey: unknown, hidden: unknown): Promise<void> {
    const row = await this.rowOf(userId, projectId);
    if (typeof rowKey !== 'string' || rowKey === '' || rowKey.length > 200) throw fail(422, 'ROW', 'Не указана строка.');
    if (hidden === false) await this.db.delete(schema.boardHidden).where(and(eq(schema.boardHidden.projectId, projectId), eq(schema.boardHidden.rowKey, rowKey)));
    else await this.db.insert(schema.boardHidden).values({ projectId, rowKey }).onConflictDoNothing();
    this.forget(row.code);
  }

  /** D-19 · the rows for the creator, hidden ones included (marked), with the keys the buttons need. */
  async rowsForCreator(userId: string, projectId: string): Promise<BoardStanding & { frozen: boolean }> {
    const row = await this.rowOf(userId, projectId);
    const standing = await this.standing(row, { includeHidden: true });
    return { ...standing, frozen: Boolean(row.frozenAt) };
  }

  /** D-13 · the own QR of the board (not the one of the passage): the address `/b/{code}` as a picture. */
  async qr(userId: string, projectId: string, format: 'svg' | 'png'): Promise<string | Buffer> {
    const row = await this.rowOf(userId, projectId);
    const url = `${this.config?.webUrl ?? ''}/b/${row.code}`;
    return format === 'svg' ? buildSvg(url, DEFAULT_QR_STYLE, null, true).svg : renderPng(url, DEFAULT_QR_STYLE, null, 1024);
  }

  // ── The standings ────────────────────────────────────────────────────────

  /** A change of the creator is seen at once, not after the three seconds of the cache. */
  private forget(code?: string): void {
    if (code) this.cache.delete(code);
  }

  private async stopTerms(): Promise<ReturnType<typeof compileTerms>> {
    const now = Date.now();
    if (this.dictionary && now - this.dictionary.at < 60_000) return this.dictionary.terms;
    const dict = this.safety ? await this.safety.dictionary() : { stopTerms: [], blockedDomains: [] };
    const terms = compileTerms(dict.stopTerms.map((t) => ({ id: t.id, text: t.text, exact: t.text.replace(/[^\p{L}\p{N}]/gu, '').length <= 3 })));
    this.dictionary = { at: now, terms };
    return terms;
  }

  /**
   * D-14, D-15, D-16 · the standings of the round: finished passages of the current round (after `resetAt`, before `frozenAt`), each by the points
   * or by the number variable; a team (the answer to a choice question) sums or averages its passages, a participant is a row of his own.
   * Equal values share a place (1, 2, 2, 4). A nick that the person did not agree to show, or that the stop words catch (D-20), is «Участник N».
   */
  async standing(board: typeof schema.boards.$inferSelect, opts: { includeHidden?: boolean } = {}): Promise<BoardStanding> {
    const [project] = await this.db.select({ published: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, board.projectId));
    const doc = await this.docById(project?.published ?? null);
    const conditions = [eq(schema.participantSessions.projectId, board.projectId), eq(schema.participantSessions.status, 'COMPLETED'), eq(schema.participantSessions.isPreview, false), isNotNull(schema.participantSessions.completedAt)];
    if (board.resetAt) conditions.push(gt(schema.participantSessions.completedAt, board.resetAt));
    if (board.frozenAt) conditions.push(lt(schema.participantSessions.completedAt, board.frozenAt));
    const sessions = await this.db
      .select({ id: schema.participantSessions.id, score: schema.participantSessions.score, completedAt: schema.participantSessions.completedAt })
      .from(schema.participantSessions)
      .where(and(...conditions))
      .orderBy(schema.participantSessions.completedAt)
      .limit(SESSIONS_MAX);
    const hiddenRows = await this.db.select({ key: schema.boardHidden.rowKey }).from(schema.boardHidden).where(eq(schema.boardHidden.projectId, board.projectId));
    const hidden = new Set(hiddenRows.map((h) => h.key));
    if (sessions.length === 0) return { rows: [], total: 0 };

    const blockIds = [board.teamBlockId, board.nickBlockId, board.consentBlockId].filter((x): x is string => Boolean(x));
    const ids = sessions.map((s) => s.id);
    const answerRows = await this.db
      .select({ sessionId: schema.answers.sessionId, blockId: schema.answers.blockId, variableId: schema.answers.variableId, value: schema.answers.value })
      .from(schema.answers)
      .where(and(inArray(schema.answers.sessionId, ids), board.metric === 'variable' && board.metricVariableId ? inArray(schema.answers.source, ['QUESTION', 'VARIABLE']) : eq(schema.answers.source, 'QUESTION')));
    const byBlock = new Map<string, Map<string, unknown>>();
    const variable = new Map<string, number>();
    for (const a of answerRows) {
      if (a.blockId && blockIds.includes(a.blockId)) {
        const m = byBlock.get(a.blockId) ?? new Map<string, unknown>();
        m.set(a.sessionId, a.value);
        byBlock.set(a.blockId, m);
      }
      if (a.variableId && a.variableId === board.metricVariableId) variable.set(a.sessionId, num(a.value));
    }
    const valueOf = (s: { id: string; score: number | null }): number => (board.metric === 'variable' ? (variable.get(s.id) ?? 0) : num(s.score));
    const blocks = new Map<string, Block>();
    if (doc) for (const sc of doc.screens) for (const b of walkBlocks(sc.blocks)) blocks.set(b.id, b);

    let rows: BoardRow[];
    if (board.groupBy === 'teams') {
      const teamBlock = board.teamBlockId ? blocks.get(board.teamBlockId) : undefined;
      const teams = new Map<string, { sum: number; count: number }>();
      for (const s of sessions) {
        const a = board.teamBlockId ? (byBlock.get(board.teamBlockId)?.get(s.id) as { kind?: string; optionIds?: string[] } | undefined) : undefined;
        const optionId = a?.kind === 'choice' ? a.optionIds?.[0] : undefined;
        if (!optionId || !teamBlock || (teamBlock.type !== 'singleChoice' && teamBlock.type !== 'multiChoice')) continue;
        const name = optionLabel(teamBlock, optionId).trim();
        if (!name) continue;
        const t = teams.get(name) ?? { sum: 0, count: 0 };
        t.sum += valueOf(s);
        t.count += 1;
        teams.set(name, t);
      }
      rows = [...teams.entries()].map(([name, t]) => ({ key: name, rank: 0, name, value: round2(board.aggregate === 'avg' ? t.sum / t.count : t.sum), count: t.count, hidden: hidden.has(name) }));
      rows.sort((x, y) => y.value - x.value || y.count - x.count || x.name.localeCompare(y.name, 'ru'));
    } else {
      const terms = await this.stopTerms();
      rows = sessions.map((s, i) => {
        const nick = board.nickBlockId ? (byBlock.get(board.nickBlockId)?.get(s.id) as { kind?: string; value?: string } | undefined) : undefined;
        const agreed = board.consentBlockId ? (byBlock.get(board.consentBlockId)?.get(s.id) as { kind?: string; value?: boolean } | undefined)?.value === true : false;
        const text = nick?.kind === 'text' && typeof nick.value === 'string' ? nick.value.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
        const shown = agreed && text !== '' && findTerms(text, terms).length === 0;
        return { key: s.id, rank: 0, name: shown ? text : `Участник ${i + 1}`, value: valueOf(s), count: 1, hidden: hidden.has(s.id) };
      });
      // Equal values: who finished first stands higher (the list above is in the order of finishing, and the sort is stable).
      rows.sort((x, y) => y.value - x.value);
    }
    const visible = opts.includeHidden ? rows : rows.filter((r) => !r.hidden);
    let place = 0;
    visible.forEach((r, i) => {
      if (i === 0 || r.value !== visible[i - 1]!.value) place = i + 1;
      r.rank = place;
    });
    return { rows: visible, total: visible.filter((r) => !r.hidden).reduce((n, r) => n + r.count, 0) };
  }

  /** D-17 · what everyone sees at `/b/{code}`: null when there is no such board, it is off, or the project is not published. Cached for three seconds. */
  async publicBoard(code: string): Promise<PublicBoard | null> {
    if (!/^[a-z0-9]{10}$/.test(code)) return null;
    const now = Date.now();
    const hit = this.cache.get(code);
    if (hit && now - hit.at < CACHE_MS) return hit.value;
    const value = await this.compute(code);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(code, { at: now, value });
    return value;
  }

  private async compute(code: string): Promise<PublicBoard | null> {
    const [board] = await this.db.select().from(schema.boards).where(eq(schema.boards.code, code));
    if (!board || !board.enabled) return null;
    const [project] = await this.db
      .select({ title: schema.projects.title, slug: schema.projects.slug, status: schema.projects.status, moderation: schema.projects.moderationStatus, deletedAt: schema.projects.deletedAt, published: schema.projects.publishedVersionId, ownerId: schema.projects.ownerId })
      .from(schema.projects)
      .where(eq(schema.projects.id, board.projectId));
    if (!project || project.deletedAt || project.status !== 'PUBLISHED' || project.moderation === 'BLOCKED') return null;
    if (this.entitlements && !(await this.entitlements.scoreboardAllowed(project.ownerId, board.projectId))) return null;
    const doc = await this.docById(project.published);
    if (!doc) return null;
    const standing = await this.standing(board);
    const variableName = board.metric === 'variable' ? doc.variables.find((v) => v.id === board.metricVariableId)?.name : undefined;
    return {
      title: project.title,
      // The slug of the project is what the page of «Пожаловаться» and the link «Пройти» need; it is public anyway (it is the address of the passage).
      slug: project.slug,
      groupBy: board.groupBy === 'teams' ? 'teams' : 'participants',
      metric: board.metric === 'variable' ? 'variable' : 'score',
      metricTitle: variableName ?? 'Баллы',
      aggregate: board.aggregate === 'avg' ? 'avg' : 'sum',
      frozen: Boolean(board.frozenAt),
      total: standing.total,
      rows: standing.rows.slice(0, ROWS_MAX).map((r) => ({ rank: r.rank, name: r.name, value: r.value, count: r.count })),
      updatedAt: new Date().toISOString(),
      theme: toPublicDocument(doc).theme,
    };
  }

  // ── The participant's side ───────────────────────────────────────────────

  /** D-18 · the code of the board when the creator switched it on and wants the button on the last screen. */
  async finishLink(projectId: string): Promise<{ code: string } | null> {
    const [b] = await this.db.select({ code: schema.boards.code, enabled: schema.boards.enabled, show: schema.boards.showOnFinish }).from(schema.boards).where(eq(schema.boards.projectId, projectId));
    return b?.enabled && b.show ? { code: b.code } : null;
  }

  /** D-18 · the place of a finished passage and the number of passages counted — for `{{место}}` and `{{всего_участников}}`. null — no board, or the passage is not in it. */
  async placeOf(projectId: string, sessionId: string): Promise<{ place: number | null; total: number } | null> {
    const [board] = await this.db.select().from(schema.boards).where(eq(schema.boards.projectId, projectId));
    if (!board || !board.enabled) return null;
    const standing = await this.standing(board);
    if (board.groupBy === 'participants') {
      const row = standing.rows.find((r) => r.key === sessionId);
      return { place: row?.rank ?? null, total: standing.total };
    }
    // Teams: the place of the team the passage belongs to.
    const team = board.teamBlockId
      ? (await this.db.select({ value: schema.answers.value }).from(schema.answers).where(and(eq(schema.answers.sessionId, sessionId), eq(schema.answers.blockId, board.teamBlockId))))[0]
      : undefined;
    const [project] = await this.db.select({ published: schema.projects.publishedVersionId }).from(schema.projects).where(eq(schema.projects.id, projectId));
    const doc = await this.docById(project?.published ?? null);
    const a = team?.value as { kind?: string; optionIds?: string[] } | undefined;
    const block = doc && board.teamBlockId ? [...doc.screens.flatMap((s) => [...walkBlocks(s.blocks)])].find((b) => b.id === board.teamBlockId) : undefined;
    const name = a?.kind === 'choice' && a.optionIds?.[0] && block && (block.type === 'singleChoice' || block.type === 'multiChoice') ? optionLabel(block, a.optionIds[0]).trim() : '';
    const row = standing.rows.find((r) => r.key === name);
    return { place: row?.rank ?? null, total: standing.total };
  }
}
