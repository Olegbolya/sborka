import { ForbiddenException, Inject, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { plainText, walkBlocks } from '@blokum/schema';
import { DB } from '../tokens.js';

const DAY_MS = 86_400_000;
const MAX_SESSIONS = 50_000;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));

export interface NamedCount {
  key: string;
  name: string;
  count: number;
}

export interface Analytics {
  range: { from: string; to: string };
  /** The totals of the days: from the daily summaries (they outlive the raw answers). */
  totals: { opens: number; starts: number; completions: number; completionRate: number | null; avgDurationMs: number | null };
  byDay: Array<{ day: string; opens: number; starts: number; completions: number }>;
  byAccessPoint: Array<{ id: string; label: string; kind: string; opens: number; starts: number; completions: number }>;
  byDevice: Array<{ device: string; starts: number; completions: number }>;
  /** The funnel by screens: how many passages reached a screen and how many ended there; the average time on the screen is taken from the answers given on it. */
  funnel: Array<{ screenId: string; name: string; reached: number; leftHere: number; avgTimeMs: number | null }>;
  /** The distribution of answers to the questions. */
  questions: Array<{ blockId: string; name: string; screen: string; answered: number; options: NamedCount[] }>;
  results: NamedCount[];
  /** RN-02 · the values of games the participants' devices have counted: how many, the least, the most, the average. */
  values: Array<{ variableId: string; name: string; count: number; min: number | null; max: number | null; avg: number | null; top: NamedCount[] }>;
}

/**
 * P6.5 · D-05 · the analytics of a project. The daily summaries `project_stats_daily` are rolled up from the raw passages (an hour after an hour
 * for the last days) and are kept after the raw answers are gone; the funnel and the distributions are worked out from the raw data at hand.
 */
@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Every hour while the API runs (not under tests): the last three days are rolled up again, so a late finish is counted. */
  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    const run = () => void this.rollup(addDays(dayOf(new Date()), -2), dayOf(new Date())).catch(() => undefined);
    this.timer = setInterval(run, 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Works out `starts`, `completions` and the average duration for the days `from`…`to` (UTC dates, both included) from the raw
   * passages, for the whole project (`accessPointId = ''`) and for each access point. `opens` is counted on the way and is not touched.
   * Calling it again changes nothing. A preview is not a passage.
   */
  async rollup(from: string, to: string, projectId?: string): Promise<number> {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS);
    const scope = projectId ? eq(schema.participantSessions.projectId, projectId) : undefined;
    const startedDay = sql<string>`to_char(${schema.participantSessions.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const doneDay = sql<string>`to_char(${schema.participantSessions.completedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const started = await this.db
      .select({ projectId: schema.participantSessions.projectId, day: startedDay, ap: schema.participantSessions.accessPointId, n: sql<number>`count(*)::int` })
      .from(schema.participantSessions)
      .where(and(eq(schema.participantSessions.isPreview, false), gte(schema.participantSessions.startedAt, start), lt(schema.participantSessions.startedAt, end), scope))
      .groupBy(schema.participantSessions.projectId, startedDay, schema.participantSessions.accessPointId);
    const finished = await this.db
      .select({
        projectId: schema.participantSessions.projectId,
        day: doneDay,
        ap: schema.participantSessions.accessPointId,
        n: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${schema.participantSessions.durationMs}), 0)::bigint`,
        timed: sql<number>`count(${schema.participantSessions.durationMs})::int`,
      })
      .from(schema.participantSessions)
      .where(and(eq(schema.participantSessions.isPreview, false), eq(schema.participantSessions.status, 'COMPLETED'), isNotNull(schema.participantSessions.completedAt), gte(schema.participantSessions.completedAt, start), lt(schema.participantSessions.completedAt, end), scope))
      .groupBy(schema.participantSessions.projectId, doneDay, schema.participantSessions.accessPointId);

    type Cell = { starts: number; completions: number; sum: number; timed: number };
    const cells = new Map<string, Cell>();
    const cell = (projectId: string, day: string, ap: string): Cell => {
      const key = `${projectId}|${day}|${ap}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { starts: 0, completions: 0, sum: 0, timed: 0 }));
      return c;
    };
    for (const r of started) for (const ap of new Set([r.ap ?? '', ''])) cell(r.projectId, r.day, ap).starts += r.n;
    for (const r of finished) {
      for (const ap of new Set([r.ap ?? '', ''])) {
        const c = cell(r.projectId, r.day, ap);
        c.completions += r.n;
        c.sum += Number(r.sum);
        c.timed += r.timed;
      }
    }

    // The oldest raw passage of each project: before it the raw data may be gone (the term of keeping answers), and the summaries are all that is left.
    const oldest = await this.db
      .select({ projectId: schema.participantSessions.projectId, at: sql<Date>`min(${schema.participantSessions.startedAt})` })
      .from(schema.participantSessions)
      .where(scope)
      .groupBy(schema.participantSessions.projectId);
    const oldestDay = new Map(oldest.map((o) => [o.projectId, dayOf(new Date(o.at))]));

    return this.db.transaction(async (tx) => {
      // What was counted before and is not there now (a passage deleted by its owner) goes to zero — but only where the raw data still reaches.
      const before = await tx
        .select({ projectId: schema.projectStatsDaily.projectId, day: schema.projectStatsDaily.day, ap: schema.projectStatsDaily.accessPointId })
        .from(schema.projectStatsDaily)
        .where(and(gte(schema.projectStatsDaily.day, from), sql`${schema.projectStatsDaily.day} <= ${to}`, projectId ? eq(schema.projectStatsDaily.projectId, projectId) : undefined));
      for (const r of before) {
        const raw = oldestDay.get(r.projectId);
        if (cells.has(`${r.projectId}|${r.day}|${r.ap}`) || (raw !== undefined && r.day < raw)) continue;
        await tx
          .update(schema.projectStatsDaily)
          .set({ starts: 0, completions: 0, avgDurationMs: null })
          .where(and(eq(schema.projectStatsDaily.projectId, r.projectId), eq(schema.projectStatsDaily.day, r.day), eq(schema.projectStatsDaily.accessPointId, r.ap)));
      }
      for (const [key, c] of cells) {
        const [pid, day, ap] = key.split('|') as [string, string, string];
        const avg = c.timed > 0 ? Math.round(c.sum / c.timed) : null;
        await tx
          .insert(schema.projectStatsDaily)
          .values({ projectId: pid, day, accessPointId: ap, starts: c.starts, completions: c.completions, avgDurationMs: avg })
          .onConflictDoUpdate({
            target: [schema.projectStatsDaily.projectId, schema.projectStatsDaily.day, schema.projectStatsDaily.accessPointId],
            set: { starts: c.starts, completions: c.completions, avgDurationMs: avg },
          });
      }
      return cells.size;
    });
  }

  async analytics(userId: string, projectId: string, opts: { from?: string; to?: string } = {}, now = new Date()): Promise<Analytics> {
    const [project] = await this.db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new NotFoundException();
    if (project.ownerId !== userId) throw new ForbiddenException();
    const valid = (d?: string): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    const to = valid(opts.to) ? opts.to : dayOf(now);
    const from = valid(opts.from) ? opts.from : addDays(to, -29);
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    // The requested days are rolled up before reading: the numbers are not an hour late and the days before this feature are there too.
    await this.rollup(lo, hi, projectId);

    const rows = await this.db
      .select()
      .from(schema.projectStatsDaily)
      .where(and(eq(schema.projectStatsDaily.projectId, projectId), gte(schema.projectStatsDaily.day, lo), sql`${schema.projectStatsDaily.day} <= ${hi}`))
      .orderBy(asc(schema.projectStatsDaily.day));
    const total = rows.filter((r) => r.accessPointId === '');
    const sum = (list: typeof rows, key: 'opens' | 'starts' | 'completions') => list.reduce((s, r) => s + r[key], 0);
    const timedDone = total.filter((r) => r.avgDurationMs !== null && r.completions > 0);
    const weight = timedDone.reduce((s, r) => s + r.completions, 0);
    const starts = sum(total, 'starts');
    const completions = sum(total, 'completions');

    const points = await this.db.select({ id: schema.accessPoints.id, label: schema.accessPoints.label, kind: schema.accessPoints.kind }).from(schema.accessPoints).where(eq(schema.accessPoints.projectId, projectId));
    const byAccessPoint = points.map((p) => {
      const mine = rows.filter((r) => r.accessPointId === p.id);
      return { id: p.id, label: p.label || (p.kind === 'QR' ? 'QR-код' : 'Ссылка'), kind: p.kind, opens: sum(mine, 'opens'), starts: sum(mine, 'starts'), completions: sum(mine, 'completions') };
    });

    const raw = await this.rawParts(projectId, new Date(`${lo}T00:00:00Z`), new Date(Date.parse(`${hi}T00:00:00Z`) + DAY_MS));
    return {
      range: { from: lo, to: hi },
      totals: { opens: sum(total, 'opens'), starts, completions, completionRate: starts > 0 ? Math.round((completions / starts) * 1000) / 10 : null, avgDurationMs: weight > 0 ? Math.round(timedDone.reduce((s, r) => s + (r.avgDurationMs ?? 0) * r.completions, 0) / weight) : null },
      byDay: total.map((r) => ({ day: r.day, opens: r.opens, starts: r.starts, completions: r.completions })),
      byAccessPoint,
      ...raw,
    };
  }

  /** What only the raw data can say: the devices, the funnel by screens, the answers, the results, the values of games. */
  private async rawParts(projectId: string, start: Date, end: Date): Promise<Pick<Analytics, 'byDevice' | 'funnel' | 'questions' | 'results' | 'values'>> {
    const sessions = await this.db
      .select({ id: schema.participantSessions.id, versionId: schema.participantSessions.versionId, status: schema.participantSessions.status, deviceType: schema.participantSessions.deviceType, resultKey: schema.participantSessions.resultKey, state: schema.participantSessions.runtimeState })
      .from(schema.participantSessions)
      .where(and(eq(schema.participantSessions.projectId, projectId), eq(schema.participantSessions.isPreview, false), gte(schema.participantSessions.startedAt, start), lt(schema.participantSessions.startedAt, end)))
      .limit(MAX_SESSIONS);

    // The names come from the versions the passages went through; the order of screens — from the newest of them.
    const versionIds = [...new Set(sessions.map((s) => s.versionId))];
    const docs = versionIds.length
      ? await this.db.select({ id: schema.projectVersions.id, number: schema.projectVersions.number, document: schema.projectVersions.document }).from(schema.projectVersions).where(inArray(schema.projectVersions.id, versionIds)).orderBy(asc(schema.projectVersions.number))
      : [];
    const screens = new Map<string, string>();
    const screenOf = new Map<string, string>();
    const blockNames = new Map<string, string>();
    const optionNames = new Map<string, string>();
    const questionOptions = new Map<string, string[]>();
    const variableNames = new Map<string, string>();
    for (const v of docs) {
      const doc = v.document as unknown as { screens?: Array<{ id: string; name: string; blocks: Parameters<typeof walkBlocks>[0] }>; variables?: Array<{ id: string; name: string }> };
      for (const variable of doc.variables ?? []) variableNames.set(variable.id, variable.name);
      for (const screen of doc.screens ?? []) {
        screens.delete(screen.id);
        screens.set(screen.id, screen.name);
        for (const block of walkBlocks(screen.blocks)) {
          const options = (block.props as { options?: Array<{ id: string; blockId?: string }> }).options;
          if (!options) continue;
          blockNames.set(block.id, (block.textLayer && plainText(block.textLayer).trim()) || block.name);
          screenOf.set(block.id, screen.name);
          questionOptions.set(block.id, options.map((o) => o.id));
          for (const o of options) {
            const child = block.children.find((c) => c.id === o.blockId);
            optionNames.set(o.id, (child?.textLayer ? plainText(child.textLayer).trim() : '') || child?.name || 'Вариант');
          }
        }
      }
    }

    const devices = new Map<string, { starts: number; completions: number }>();
    const reached = new Map<string, number>();
    const left = new Map<string, number>();
    const results = new Map<string, number>();
    for (const s of sessions) {
      const d = devices.get(s.deviceType) ?? { starts: 0, completions: 0 };
      d.starts += 1;
      if (s.status === 'COMPLETED') d.completions += 1;
      devices.set(s.deviceType, d);
      const state = (s.state ?? {}) as { screenId?: string; history?: string[] };
      const route = [...(state.history ?? []), ...(state.screenId ? [state.screenId] : [])];
      for (const id of new Set(route)) reached.set(id, (reached.get(id) ?? 0) + 1);
      const last = route[route.length - 1];
      if (last && s.status !== 'COMPLETED') left.set(last, (left.get(last) ?? 0) + 1);
      if (s.status === 'COMPLETED' && s.resultKey) results.set(s.resultKey, (results.get(s.resultKey) ?? 0) + 1);
    }

    const ids = sessions.map((s) => s.id);
    const answers: Array<{ screenId: string | null; blockId: string | null; variableId: string | null; value: unknown; timeOnScreenMs: number | null; source: string }> = [];
    for (let i = 0; i < ids.length; i += 1000) {
      answers.push(
        ...(await this.db
          .select({ screenId: schema.answers.screenId, blockId: schema.answers.blockId, variableId: schema.answers.variableId, value: schema.answers.value, timeOnScreenMs: schema.answers.timeOnScreenMs, source: schema.answers.source })
          .from(schema.answers)
          .where(inArray(schema.answers.sessionId, ids.slice(i, i + 1000)))),
      );
    }

    const time = new Map<string, { sum: number; n: number }>();
    const asked = new Map<string, { answered: number; counts: Map<string, number> }>();
    const values = new Map<string, number[]>();
    const tops = new Map<string, Map<string, number>>();
    for (const a of answers) {
      if (a.screenId && a.timeOnScreenMs !== null) {
        const t = time.get(a.screenId) ?? { sum: 0, n: 0 };
        t.sum += a.timeOnScreenMs;
        t.n += 1;
        time.set(a.screenId, t);
      }
      if (a.source === 'QUESTION' && a.blockId) {
        const q = asked.get(a.blockId) ?? { answered: 0, counts: new Map<string, number>() };
        q.answered += 1;
        const v = a.value as { kind?: string; optionIds?: unknown };
        if (Array.isArray(v?.optionIds)) for (const o of v.optionIds) if (typeof o === 'string') q.counts.set(o, (q.counts.get(o) ?? 0) + 1);
        asked.set(a.blockId, q);
      } else if (a.source === 'VARIABLE' && a.variableId) {
        if (typeof a.value === 'number' && Number.isFinite(a.value)) values.set(a.variableId, [...(values.get(a.variableId) ?? []), a.value]);
        const top = tops.get(a.variableId) ?? new Map<string, number>();
        const shown = typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
        top.set(shown, (top.get(shown) ?? 0) + 1);
        tops.set(a.variableId, top);
      }
    }

    const variableIds = new Set([...values.keys(), ...tops.keys()]);
    return {
      byDevice: [...devices].map(([device, d]) => ({ device, ...d })).sort((a, b) => b.starts - a.starts),
      funnel: [...screens].map(([screenId, name]) => {
        const t = time.get(screenId);
        return { screenId, name, reached: reached.get(screenId) ?? 0, leftHere: left.get(screenId) ?? 0, avgTimeMs: t && t.n > 0 ? Math.round(t.sum / t.n) : null };
      }),
      questions: [...questionOptions].map(([blockId, optionIds]) => {
        const q = asked.get(blockId);
        return { blockId, name: blockNames.get(blockId) ?? 'Вопрос', screen: screenOf.get(blockId) ?? '', answered: q?.answered ?? 0, options: optionIds.map((o) => ({ key: o, name: optionNames.get(o) ?? 'Вариант', count: q?.counts.get(o) ?? 0 })) };
      }),
      results: [...results].map(([key, count]) => ({ key, name: key, count })).sort((a, b) => b.count - a.count),
      values: [...variableIds].map((variableId) => {
        const nums = values.get(variableId) ?? [];
        const top = [...(tops.get(variableId) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => ({ key, name: key, count }));
        return {
          variableId,
          name: variableNames.get(variableId) ?? 'Значение',
          count: [...(tops.get(variableId)?.values() ?? [])].reduce((s, n) => s + n, 0),
          min: nums.length ? Math.min(...nums) : null,
          max: nums.length ? Math.max(...nums) : null,
          avg: nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null,
          top,
        };
      }),
    };
  }
}
