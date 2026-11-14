import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { NotificationsService } from '../admin/notifications.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { DB } from '../tokens.js';
import { type PassageMode, allowedPassageModes, effectivePassageMode } from './passage-mode.js';

const PERIOD_MS: Record<'hourly' | 'daily', number> = { hourly: 3_600_000, daily: 86_400_000 };
/** The queue of one project never grows past this: the passages themselves are all in the table of answers. */
const QUEUE_LIMIT = 500;
/** The digest quotes this many passages, the rest is counted. */
const DIGEST_ITEMS = 10;

const clip = (text: string, n: number): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/**
 * D-07 · when a message about a passage goes out. The plan decides what may be chosen (04-TARIFFS: «Старт» — a digest once a day,
 * paid plans — at once, or once an hour, or once a day); the creator chooses within that, per project. A passage that is not sent at
 * once waits in `passage_digest_queue`; once a minute the digest sends what is due as ONE message (in the cabinet; no mail — decision of the owner). Switching the mode sends what has already waited under the old one the next minute.
 */
@Injectable()
export class PassageNoticesService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notices: NotificationsService,
    @Optional() private readonly entitlements?: EntitlementsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    this.timer = setInterval(() => void this.flush().catch(() => undefined), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The modes the plan of the project's owner allows: «Старт» — a digest and silence, the paid plans — all. */
  async allowedModes(ownerId: string, projectId: string): Promise<readonly PassageMode[]> {
    const level = this.entitlements ? (await this.entitlements.limitsOfProject(ownerId, projectId)).plan.limits.notifications : 'instant';
    return allowedPassageModes(level);
  }

  /** What is in force: the creator's choice if the plan allows it, otherwise the plan's own (a digest or at once). */
  async modeOf(ownerId: string, projectId: string, settings: unknown): Promise<PassageMode> {
    return effectivePassageMode(await this.allowedModes(ownerId, projectId), settings);
  }

  /** Hand over the text of a passage: at once, or into the queue of the digest. */
  async deliver(input: { ownerId: string; projectId: string; title: string; body: string; mode: PassageMode }): Promise<void> {
    if (input.mode === 'off') return;
    if (input.mode === 'instant') {
      await this.notices.notify({ userId: input.ownerId, kind: 'passage', title: input.title, body: input.body, projectId: input.projectId, mail: false });
      return;
    }
    const [queued] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.passageDigestQueue)
      .where(and(eq(schema.passageDigestQueue.userId, input.ownerId), eq(schema.passageDigestQueue.projectId, input.projectId)));
    if ((queued?.n ?? 0) >= QUEUE_LIMIT) return;
    await this.db.insert(schema.passageDigestQueue).values({ userId: input.ownerId, projectId: input.projectId, body: input.body });
  }

  /** Send the digests that are due; returns how many messages went out. `now` is a parameter so tests choose the time. */
  async flush(now: Date = new Date()): Promise<number> {
    const groups = await this.db
      .select({
        userId: schema.passageDigestQueue.userId,
        projectId: schema.passageDigestQueue.projectId,
        oldest: sql<Date>`min(${schema.passageDigestQueue.createdAt})`,
      })
      .from(schema.passageDigestQueue)
      .groupBy(schema.passageDigestQueue.userId, schema.passageDigestQueue.projectId);
    let sent = 0;
    for (const g of groups) {
      const [project] = await this.db.select({ title: schema.projects.title, settings: schema.projects.settings }).from(schema.projects).where(eq(schema.projects.id, g.projectId));
      const mode = project ? await this.modeOf(g.userId, g.projectId, project.settings) : 'off';
      const waited = now.getTime() - new Date(g.oldest).getTime();
      if (mode === 'off') {
        await this.db.delete(schema.passageDigestQueue).where(and(eq(schema.passageDigestQueue.userId, g.userId), eq(schema.passageDigestQueue.projectId, g.projectId)));
        continue;
      }
      if (mode !== 'instant' && waited < PERIOD_MS[mode]) continue;
      const rows = await this.db
        .select()
        .from(schema.passageDigestQueue)
        .where(and(eq(schema.passageDigestQueue.userId, g.userId), eq(schema.passageDigestQueue.projectId, g.projectId)))
        .orderBy(asc(schema.passageDigestQueue.createdAt));
      if (rows.length === 0) continue;
      const time = (d: Date): string => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
      const lines = rows.slice(0, DIGEST_ITEMS).map((r, i) => `${i + 1}. ${time(r.createdAt)} (МСК)\n${clip(r.body, 600)}`);
      const rest = rows.length - lines.length;
      const body = [...lines, ...(rest > 0 ? [`И ещё ${rest} — все прохождения в таблице ответов сборки.`] : [])].join('\n\n');
      const span = mode === 'hourly' ? 'за час' : 'за сутки';
      const title = `Новые прохождения «${clip(project?.title ?? 'Сборка', 80)}»: ${rows.length} ${span}`;
      // The rows go first: a failed letter must not send the same digest again a minute later (the cabinet message is the record).
      await this.db.delete(schema.passageDigestQueue).where(inArray(schema.passageDigestQueue.id, rows.map((r) => r.id)));
      await this.notices.notify({ userId: g.userId, kind: 'passage', title, body, projectId: g.projectId, mail: false });
      sent += 1;
    }
    return sent;
  }
}
