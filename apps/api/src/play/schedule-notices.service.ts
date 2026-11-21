import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { NotificationsService } from '../admin/notifications.service.js';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';

/**
 * A moment of the schedule is told about if it came within this window: a server that was down for a while still tells, but a
 * time set far in the past (a creator who typed yesterday's date) is not reported as «открылась» long after the fact.
 */
export const SCHEDULE_WINDOW_MS = 30 * 60_000;

const moscow = (d: Date): string => `${d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' })} (МСК)`;

/** D-07 · «о расписании»: the texts of the two messages. */
export function scheduleText(kind: 'open' | 'close', input: { title: string; at: Date; closesAt: Date | null; link: string; completions: number }): { title: string; body: string } {
  const name = `«${input.title.slice(0, 80)}»`;
  if (kind === 'open') {
    return {
      title: `Сборка ${name} открылась по расписанию`,
      body: `С ${moscow(input.at)} участники могут проходить сборку по ссылке ${input.link}.${input.closesAt ? ` Закроется ${moscow(input.closesAt)}.` : ''}`,
    };
  }
  return {
    title: `Сборка ${name} закрылась по расписанию`,
    body: `С ${moscow(input.at)} новые участники видят текст закрытой сборки. Завершённых прохождений: ${input.completions}. Ответы — на вкладке «Ответы» сборки. Продлить приём можно в «Настройках доступа» сборки: поле «Закрыть по расписанию».`,
  };
}

/**
 * D-07 · the creator hears when the schedule opens and closes a published project (PL-06: «Расписание»). Once a minute (in
 * production; tests call `check(now)`) the moments that have come are told about once each — `schedule_notices` remembers them.
 */
@Injectable()
export class ScheduleNoticesService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly notices?: NotificationsService,
    @Optional() @Inject(API_CONFIG) private readonly config?: ApiConfig,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    this.timer = setInterval(() => void this.check().catch(() => undefined), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Tell about the moments that came within the window; returns how many messages went out. */
  async check(now: Date = new Date()): Promise<number> {
    if (!this.notices) return 0;
    const rows = await this.db
      .select({ id: schema.projects.id, ownerId: schema.projects.ownerId, title: schema.projects.title, slug: schema.projects.slug, settings: schema.projects.settings })
      .from(schema.projects)
      .where(and(eq(schema.projects.status, 'PUBLISHED'), isNull(schema.projects.deletedAt), sql`(${schema.projects.settings} ? 'scheduledOpenAt' or ${schema.projects.settings} ? 'scheduledCloseAt')`));
    let sent = 0;
    for (const p of rows) {
      const settings = (p.settings ?? {}) as { scheduledOpenAt?: string | null; scheduledCloseAt?: string | null };
      const opens = settings.scheduledOpenAt ? new Date(settings.scheduledOpenAt) : null;
      const closes = settings.scheduledCloseAt ? new Date(settings.scheduledCloseAt) : null;
      for (const [kind, at] of [['open', opens], ['close', closes]] as const) {
        if (!at || Number.isNaN(at.getTime())) continue;
        const since = now.getTime() - at.getTime();
        if (since < 0 || since > SCHEDULE_WINDOW_MS) continue;
        // An opening after which the project is already closed again is not news.
        if (kind === 'open' && closes && closes <= now) continue;
        const fresh = await this.db.insert(schema.scheduleNotices).values({ projectId: p.id, kind, at }).onConflictDoNothing().returning({ at: schema.scheduleNotices.at });
        if (fresh.length === 0) continue;
        const [done] = await this.db
          .select({ value: schema.limitCounters.value })
          .from(schema.limitCounters)
          .where(and(eq(schema.limitCounters.projectId, p.id), eq(schema.limitCounters.kind, 'COMPLETIONS')));
        const text = scheduleText(kind, { title: p.title, at, closesAt: closes, link: `${this.config?.webUrl ?? ''}/s/${p.slug}`, completions: done?.value ?? 0 });
        await this.notices.notify({ userId: p.ownerId, kind: `schedule-${kind}`, title: text.title, body: text.body, projectId: p.id }).catch(() => undefined);
        sent += 1;
      }
    }
    return sent;
  }
}
