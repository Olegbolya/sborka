import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { type ProjectDocument, limitedOptions, plainText, walkBlocks } from '@blokum/schema';
import { holdHoursOf } from '../play/choice-limits.js';
import { DB } from '../tokens.js';

export interface ChoiceHolder {
  sessionId: string;
  startedAt: string;
  status: string;
  /** What the passage said about itself in a text question (a name), when there is one: the creator sees who took the place. */
  who: string | null;
}

export interface ChoicePlace {
  questionBlockId: string;
  question: string;
  optionId: string;
  label: string;
  limit: number;
  used: number;
  holders: ChoiceHolder[];
}

/** D-12 · the places of limited options for the creator: who holds each, and the manual release (PL-26). */
@Injectable()
export class ChoiceLimitsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async docOf(userId: string, projectId: string): Promise<{ doc: ProjectDocument }> {
    const [p] = await this.db.select({ ownerId: schema.projects.ownerId, published: schema.projects.publishedVersionId, draft: schema.projects.draftVersionId, deletedAt: schema.projects.deletedAt }).from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!p || p.deletedAt) throw new NotFoundException();
    if (p.ownerId !== userId) throw new ForbiddenException();
    const versionId = p.published ?? p.draft;
    const [v] = versionId ? await this.db.select({ document: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, versionId)) : [];
    if (!v) throw new NotFoundException();
    return { doc: v.document as unknown as ProjectDocument };
  }

  async list(userId: string, projectId: string): Promise<{ holdHours: number; places: ChoicePlace[] }> {
    const { doc } = await this.docOf(userId, projectId);
    const limited = limitedOptions(doc);
    const holdHours = holdHoursOf(doc);
    if (limited.length === 0) return { holdHours, places: [] };
    const since = new Date(Date.now() - holdHours * 3_600_000);
    const rows = await this.db.execute<{ option_id: string; session_id: string; started_at: Date; status: string }>(sql`
      select o.option_id, s.id as session_id, s.started_at, s.status
      from ${schema.answers} a
      join ${schema.participantSessions} s on s.id = a.session_id
      cross join lateral jsonb_array_elements_text(a.value->'optionIds') as o(option_id)
      where s.project_id = ${projectId} and a.source = 'QUESTION' and a.value->>'kind' = 'choice' and s.is_preview = false
        and (s.status = 'COMPLETED' or (s.status = 'IN_PROGRESS' and s.last_activity_at > ${since}))
        and o.option_id in (${sql.join(limited.map((o) => sql`${o.optionId}`), sql`, `)})
        and not exists (select 1 from ${schema.choiceReleases} r where r.session_id = s.id and r.option_id = o.option_id)
      order by s.started_at`);
    // The name a passage gave: the first text answer of a question that asks for a name, else of any text question.
    const sessionIds = [...new Set(rows.rows.map((r) => r.session_id))];
    const texts = sessionIds.length
      ? await this.db.select({ sessionId: schema.answers.sessionId, blockId: schema.answers.blockId, value: schema.answers.value }).from(schema.answers).where(and(inArray(schema.answers.sessionId, sessionIds), eq(schema.answers.source, 'QUESTION')))
      : [];
    const nameQuestions: string[] = [];
    const textQuestions: string[] = [];
    const labels = new Map<string, string>();
    const questionNames = new Map<string, string>();
    for (const s of doc.screens) {
      for (const b of walkBlocks(s.blocks)) {
        if (b.type === 'textInput') (b.props.semantic === 'name' ? nameQuestions : textQuestions).push(b.id);
        if (b.type === 'singleChoice' || b.type === 'multiChoice') questionNames.set(b.id, b.name);
        labels.set(b.id, b.textLayer ? plainText(b.textLayer) : b.name);
      }
    }
    const whoOf = (sessionId: string): string | null => {
      const mine = texts.filter((t) => t.sessionId === sessionId && t.blockId && (t.value as { kind?: string }).kind === 'text');
      for (const group of [nameQuestions, textQuestions]) {
        const hit = mine.find((t) => group.includes(t.blockId!));
        const v = (hit?.value as { value?: string } | undefined)?.value?.trim();
        if (v) return v.slice(0, 80);
      }
      return null;
    };
    const places = limited.map((o): ChoicePlace => {
      const holders = rows.rows
        .filter((r) => r.option_id === o.optionId)
        .map((r) => ({ sessionId: r.session_id, startedAt: new Date(r.started_at).toISOString(), status: r.status, who: whoOf(r.session_id) }));
      return { questionBlockId: o.questionBlockId, question: questionNames.get(o.questionBlockId) ?? '', optionId: o.optionId, label: labels.get(o.blockId) || o.optionId, limit: o.limit, used: holders.length, holders };
    });
    return { holdHours, places };
  }

  /** PL-26 · D-12: the creator frees the place a passage holds; the passage's answer stays in the table as it was. */
  async release(userId: string, projectId: string, sessionId: unknown, optionId: unknown): Promise<void> {
    await this.docOf(userId, projectId);
    if (typeof sessionId !== 'string' || typeof optionId !== 'string') throw new NotFoundException();
    const [s] = await this.db.select({ id: schema.participantSessions.id }).from(schema.participantSessions).where(and(eq(schema.participantSessions.id, sessionId), eq(schema.participantSessions.projectId, projectId)));
    if (!s) throw new NotFoundException();
    await this.db.insert(schema.choiceReleases).values({ sessionId, optionId }).onConflictDoNothing();
  }
}
