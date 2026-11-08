import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { plainText, walkBlocks } from '@blokum/schema';
import { Inject } from '@nestjs/common';
import { DB } from '../tokens.js';

export interface ResponseRow {
  id: string;
  projectId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  deviceType: string;
  score: number | null;
  resultKey: string | null;
  accessPointId: string | null;
  viewedAt: Date | null;
}

export interface ResponseDetail extends ResponseRow {
  answers: Array<{
    id: string;
    screenId: string | null;
    blockId: string | null;
    variableId: string | null;
    source: string;
    value: unknown;
    answeredAt: Date;
    /** RN-02 · counted on the participant's device, only checked for plausibility here. */
    deviceReported: boolean;
    /** Name of the block or the variable, and the answer as a person reads it (the text of the chosen option, the typed text). */
    label: string;
    shown: string;
  }>;
  /** D-04 · the names of the screens the participant went through, in order. */
  path: string[];
  /** D-04 · how the participant came: by a link or by a QR code (the label of the access point, if it has one). */
  source: { kind: 'LINK' | 'QR'; label: string };
}

export interface ResponsesPage {
  items: ResponseRow[];
  nextCursor: string | null;
}

@Injectable()
export class ResponsesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listResponses(
    userId: string,
    projectId: string,
    opts: { cursor?: string; limit?: number; status?: string } = {},
  ): Promise<ResponsesPage> {
    await this.assertProjectOwner(userId, projectId);
    const limit = Math.min(opts.limit ?? 50, 200);

    const rows = await this.db
      .select({
        id: schema.participantSessions.id,
        projectId: schema.participantSessions.projectId,
        status: schema.participantSessions.status,
        startedAt: schema.participantSessions.startedAt,
        completedAt: schema.participantSessions.completedAt,
        durationMs: schema.participantSessions.durationMs,
        deviceType: schema.participantSessions.deviceType,
        score: schema.participantSessions.score,
        resultKey: schema.participantSessions.resultKey,
        accessPointId: schema.participantSessions.accessPointId,
        viewedAt: schema.participantSessions.viewedAt,
      })
      .from(schema.participantSessions)
      .where(
        and(
          eq(schema.participantSessions.projectId, projectId),
          eq(schema.participantSessions.isPreview, false),
          opts.status ? eq(schema.participantSessions.status, opts.status as 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'REJECTED') : undefined,
          opts.cursor ? sql`${schema.participantSessions.startedAt} < (SELECT started_at FROM participant_sessions WHERE id = ${opts.cursor})` : undefined,
        ),
      )
      .orderBy(desc(schema.participantSessions.startedAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async getResponse(userId: string, sessionId: string): Promise<ResponseDetail> {
    const rows = await this.db
      .select({
        id: schema.participantSessions.id,
        projectId: schema.participantSessions.projectId,
        status: schema.participantSessions.status,
        startedAt: schema.participantSessions.startedAt,
        completedAt: schema.participantSessions.completedAt,
        durationMs: schema.participantSessions.durationMs,
        deviceType: schema.participantSessions.deviceType,
        score: schema.participantSessions.score,
        resultKey: schema.participantSessions.resultKey,
        accessPointId: schema.participantSessions.accessPointId,
        viewedAt: schema.participantSessions.viewedAt,
        versionId: schema.participantSessions.versionId,
        runtimeState: schema.participantSessions.runtimeState,
      })
      .from(schema.participantSessions)
      .where(eq(schema.participantSessions.id, sessionId));

    const session = rows[0];
    if (!session) throw new NotFoundException();
    await this.assertProjectOwner(userId, session.projectId);

    const answers = await this.db
      .select({
        id: schema.answers.id,
        screenId: schema.answers.screenId,
        blockId: schema.answers.blockId,
        variableId: schema.answers.variableId,
        source: schema.answers.source,
        value: schema.answers.value,
        answeredAt: schema.answers.answeredAt,
        deviceReported: schema.answers.deviceReported,
      })
      .from(schema.answers)
      .where(eq(schema.answers.sessionId, sessionId))
      .orderBy(schema.answers.answeredAt);

    const names = await this.namesOf(session.versionId);
    const state = (session.runtimeState ?? {}) as { screenId?: string | null; history?: string[] };
    const route = [...(state.history ?? []), ...(state.screenId ? [state.screenId] : [])];
    const path = route.filter((id, i) => id !== route[i - 1]).map((id) => names.screens.get(id) ?? 'Экран удалён');
    let source: ResponseDetail['source'] = { kind: 'LINK', label: 'Ссылка' };
    if (session.accessPointId) {
      const [point] = await this.db.select({ kind: schema.accessPoints.kind, label: schema.accessPoints.label }).from(schema.accessPoints).where(eq(schema.accessPoints.id, session.accessPointId));
      if (point) source = { kind: point.kind, label: point.label || (point.kind === 'QR' ? 'QR-код' : 'Ссылка') };
    }
    const { versionId: _version, runtimeState: _state, ...row } = session;
    return {
      ...row,
      path,
      source,
      answers: answers.map((a) => ({
        ...a,
        label: (a.blockId && names.blocks.get(a.blockId)) || (a.variableId && names.variables.get(a.variableId)) || 'Ответ',
        shown: showValue(a.value, names.options),
      })),
    };
  }

  /** The names in the document as it was published for this passage: screens, blocks, variables and the texts of options. */
  private async namesOf(versionId: string) {
    const names = { screens: new Map<string, string>(), blocks: new Map<string, string>(), variables: new Map<string, string>(), options: new Map<string, string>() };
    const [v] = await this.db.select({ document: schema.projectVersions.document }).from(schema.projectVersions).where(eq(schema.projectVersions.id, versionId));
    const doc = v?.document as unknown as { screens?: Array<{ id: string; name: string; blocks: Parameters<typeof walkBlocks>[0] }>; variables?: Array<{ id: string; name: string }> } | undefined;
    for (const variable of doc?.variables ?? []) names.variables.set(variable.id, variable.name);
    for (const screen of doc?.screens ?? []) {
      names.screens.set(screen.id, screen.name);
      for (const block of walkBlocks(screen.blocks)) {
        names.blocks.set(block.id, block.textLayer && plainText(block.textLayer).trim() ? plainText(block.textLayer).trim() : block.name);
        const options = (block.props as { options?: Array<{ id: string; blockId?: string }> }).options;
        for (const option of options ?? []) {
          const child = block.children.find((c) => c.id === option.blockId);
          names.options.set(option.id, (child?.textLayer ? plainText(child.textLayer).trim() : '') || child?.name || 'Вариант');
        }
      }
    }
    return names;
  }

  async deleteResponse(userId: string, sessionId: string): Promise<void> {
    const rows = await this.db
      .select({ projectId: schema.participantSessions.projectId })
      .from(schema.participantSessions)
      .where(eq(schema.participantSessions.id, sessionId));
    const session = rows[0];
    if (!session) throw new NotFoundException();
    await this.assertProjectOwner(userId, session.projectId);
    await this.db.delete(schema.participantSessions).where(eq(schema.participantSessions.id, sessionId));
  }

  async markViewed(userId: string, sessionId: string): Promise<void> {
    const rows = await this.db
      .select({ projectId: schema.participantSessions.projectId })
      .from(schema.participantSessions)
      .where(eq(schema.participantSessions.id, sessionId));
    const session = rows[0];
    if (!session) throw new NotFoundException();
    await this.assertProjectOwner(userId, session.projectId);
    await this.db
      .update(schema.participantSessions)
      .set({ viewedAt: new Date() })
      .where(eq(schema.participantSessions.id, sessionId));
  }

  private async assertProjectOwner(userId: string, projectId: string): Promise<void> {
    const rows = await this.db
      .select({ ownerId: schema.projects.ownerId })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    const project = rows[0];
    if (!project) throw new NotFoundException();
    if (project.ownerId !== userId) throw new ForbiddenException();
  }
}

/** An answer the way the creator reads it: the chosen options by their texts, a text as typed, a number as a number. */
function showValue(value: unknown, options: Map<string, string>): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return typeof value === 'string' ? value : JSON.stringify(value);
  const v = value as { kind?: string; value?: unknown; optionIds?: string[]; order?: string[]; values?: Record<string, string> };
  if (v.kind === 'choice') return (v.optionIds ?? []).map((id) => options.get(id) ?? 'Вариант').join(', ');
  if (v.kind === 'ranking') return (v.order ?? []).map((id) => options.get(id) ?? 'Вариант').join(' → ');
  if (v.kind === 'contacts') return Object.entries(v.values ?? {}).map(([k, x]) => `${k}: ${x}`).join('; ');
  if (v.kind === 'swipe') return v.value === 'right' ? 'вправо' : 'влево';
  if (v.kind === 'consent') return v.value ? 'согласен' : 'не согласен';
  if (typeof v.value === 'string' || typeof v.value === 'number' || typeof v.value === 'boolean') return String(v.value);
  return JSON.stringify(value);
}
