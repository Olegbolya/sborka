import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
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
  }>;
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
      })
      .from(schema.answers)
      .where(eq(schema.answers.sessionId, sessionId))
      .orderBy(schema.answers.answeredAt);

    return { ...session, answers };
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
