import { sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { type LimitedOption, type ProjectDocument, limitedOptions } from '@blokum/schema';

/** The database handle inside or outside a transaction. */
type Q = Pick<Db, 'select' | 'execute'>;

/**
 * B-24, PL-24, PL-26 · how many places of limited options are taken. A place is held by a finished passage, or by one still going
 * that has done something within the hold time (`settings.choiceHoldHours`); a place the creator freed (D-12) is not held, and a
 * preview of the creator holds nothing. Everything is counted by option id over the whole project, whatever the version.
 */
export async function takenCounts(db: Q, projectId: string, optionIds: string[], holdHours: number, exceptSessionId?: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>(optionIds.map((id) => [id, 0]));
  if (optionIds.length === 0) return counts;
  const since = new Date(Date.now() - holdHours * 3_600_000);
  const rows = await db.execute<{ option_id: string; n: string }>(sql`
    select o.option_id, count(*)::text as n
    from ${schema.answers} a
    join ${schema.participantSessions} s on s.id = a.session_id
    cross join lateral jsonb_array_elements_text(a.value->'optionIds') as o(option_id)
    where s.project_id = ${projectId}
      and a.source = 'QUESTION'
      and a.value->>'kind' = 'choice'
      and s.is_preview = false
      and (s.status = 'COMPLETED' or (s.status = 'IN_PROGRESS' and s.last_activity_at > ${since}))
      and o.option_id in (${sql.join(optionIds.map((id) => sql`${id}`), sql`, `)})
      and not exists (select 1 from ${schema.choiceReleases} r where r.session_id = s.id and r.option_id = o.option_id)
      ${exceptSessionId ? sql`and s.id <> ${exceptSessionId}` : sql``}
    group by o.option_id`);
  for (const r of rows.rows) counts.set(r.option_id, Number(r.n));
  return counts;
}

/** Locks the counters of the options so that two answers choosing the last place are decided one after the other (PL-24). */
export async function lockOptions(tx: Pick<Db, 'execute'>, projectId: string, optionIds: string[]): Promise<void> {
  for (const id of [...optionIds].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`choice:${projectId}:${id}`}))`);
}

export const holdHoursOf = (doc: Pick<ProjectDocument, 'settings'>): number => doc.settings.choiceHoldHours ?? 24;

/** The options of the answer that have no place left for this passage: the ones it does not hold already and others filled up. */
export async function fullOptionsFor(db: Q, projectId: string, doc: ProjectDocument, wanted: string[], sessionId: string): Promise<string[]> {
  const limits = limitedOptions(doc).filter((o) => wanted.includes(o.optionId));
  if (limits.length === 0) return [];
  const counts = await takenCounts(db, projectId, limits.map((o) => o.optionId), holdHoursOf(doc), sessionId);
  return limits.filter((o) => (counts.get(o.optionId) ?? 0) >= o.limit).map((o) => o.optionId);
}

export interface OptionPlaces {
  /** No place is left for this passage (it does not hold one itself). */
  taken: boolean;
  /** Places left, when the creator lets the player say it; otherwise null. */
  left: number | null;
}

/** PL-25 · what the player draws for each limited option; the limits themselves and who chose stay off this answer. */
export async function placesFor(db: Q, projectId: string, doc: ProjectDocument, sessionId: string): Promise<Record<string, OptionPlaces>> {
  const limited: LimitedOption[] = limitedOptions(doc);
  if (limited.length === 0) return {};
  const ids = limited.map((o) => o.optionId);
  const hold = holdHoursOf(doc);
  const all = await takenCounts(db, projectId, ids, hold);
  const others = await takenCounts(db, projectId, ids, hold, sessionId);
  const out: Record<string, OptionPlaces> = {};
  for (const o of limited) {
    const used = all.get(o.optionId) ?? 0;
    const byOthers = others.get(o.optionId) ?? 0;
    out[o.optionId] = { taken: byOthers >= o.limit, left: o.showRemaining ? Math.max(0, o.limit - used) : null };
  }
  return out;
}

