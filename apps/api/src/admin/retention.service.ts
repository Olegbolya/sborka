import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { RETENTION, yearsAgo } from '@blokum/schema';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { LocalStorageService, servedKey } from '../media/storage.js';
import { API_CONFIG, DB } from '../tokens.js';
import { type ApiConfig } from '../config.js';
import path from 'node:path';

const DAY_MS = 86_400_000;
const CHUNK = 500;

/** One line of the report of a run: what was destroyed, how many, on what ground. */
export interface Destroyed {
  kind: string;
  count: number;
  basis: string;
}

const chunks = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

/**
 * P8.8 · retention terms and destruction (05-LEGAL.md §5). Every kind of data is removed at the end of its own term; whatever is under
 * `legalHold` (a user, a project or a file) is not touched until the hold is lifted. Every removal is written to the destruction journal
 * (the confirmation of destruction by the order of Roskomnadzor № 179): what kind, how many, on what ground — never the content itself.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly storage: LocalStorageService | null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly entitlements: EntitlementsService,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.storage = config.mediaDir ? new LocalStorageService(config.mediaDir) : null;
  }

  /** Once an hour while the API runs (not under tests — they call `run` with the time they choose). */
  onModuleInit(): void {
    if (process.env.NODE_ENV !== 'production') return;
    this.timer = setInterval(() => void this.run().catch(() => undefined), 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async journal(limit = 200) {
    return this.db.select().from(schema.destructionLog).orderBy(desc(schema.destructionLog.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
  }

  async run(now = new Date()): Promise<Destroyed[]> {
    const done: Destroyed[] = [];
    const note = (kind: string, count: number, basis: string): void => {
      if (count > 0) done.push({ kind, count, basis });
    };
    note('ANSWERS', await this.purgeAnswers(now), 'Срок хранения ответов по тарифу или по выбору создателя');
    note('PROJECTS', await this.purgeProjects(now), `Удалённые сборки: ${RETENTION.deletedDays} дней на восстановление`);
    note('MEDIA', await this.purgeMedia(now), `Удалённые файлы: ${RETENTION.deletedDays} дней`);
    note('ACCOUNTS', await this.purgeAccounts(now), `Удалённые аккаунты: ${RETENTION.deletedDays} дней на восстановление`);
    note('CONSENTS', await this.purgeConsents(now), `Журнал согласий: срок согласия + ${RETENTION.consentYearsAfter} года`);
    note('ORDERS', await this.purgeOrders(now), `Заказы и платежи: ${RETENTION.ordersYears} лет`);
    note('AUDIT', await this.purgeAudit(now), `Журнал аудита: ${RETENTION.auditYears} года`);
    note('LOGINS', await this.purgeLogins(now), `Журнал входов: ${RETENTION.loginsYears} год`);
    for (const d of done) await this.db.insert(schema.destructionLog).values({ kind: d.kind, count: d.count, basis: d.basis, details: { at: now.toISOString() } });
    return done;
  }

  /** Answers and events of passages: older than the term of the plan of the owner, or than a shorter term the creator has set. */
  private async purgeAnswers(now: Date): Promise<number> {
    const rows = await this.db
      .select({ id: schema.projects.id, ownerId: schema.projects.ownerId, settings: schema.projects.settings })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.users.id, schema.projects.ownerId))
      .where(and(eq(schema.projects.legalHold, false), eq(schema.users.legalHold, false)));
    let total = 0;
    for (const p of rows) {
      const plan = (await this.entitlements.limitsOfProject(p.ownerId, p.id, now)).plan.limits.answersRetentionDays;
      const own = (p.settings as { answersRetentionDays?: unknown } | null)?.answersRetentionDays;
      const days = typeof own === 'number' && Number.isFinite(own) && own >= 1 ? Math.min(plan, Math.floor(own)) : plan;
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      const old = await this.db
        .select({ id: schema.participantSessions.id })
        .from(schema.participantSessions)
        .where(and(eq(schema.participantSessions.projectId, p.id), lt(schema.participantSessions.startedAt, cutoff)));
      const ids = old.map((r) => r.id);
      for (const part of chunks(ids)) {
        // The consent of a participant ends together with his data; the three years of the journal count from here.
        await this.db
          .update(schema.consentRecords)
          .set({ withdrawnAt: now })
          .where(and(eq(schema.consentRecords.subjectType, 'PARTICIPANT'), inArray(schema.consentRecords.subjectId, part), isNull(schema.consentRecords.withdrawnAt)));
        await this.db.delete(schema.participantSessions).where(inArray(schema.participantSessions.id, part));
      }
      total += ids.length;
    }
    return total;
  }

  /** Deleted projects: after 30 days gone for good (the passages go with them). */
  private async purgeProjects(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION.deletedDays * DAY_MS);
    const rows = await this.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .innerJoin(schema.users, eq(schema.users.id, schema.projects.ownerId))
      .where(and(isNotNull(schema.projects.deletedAt), lt(schema.projects.deletedAt, cutoff), eq(schema.projects.legalHold, false), eq(schema.users.legalHold, false)));
    for (const part of chunks(rows.map((r) => r.id))) await this.db.delete(schema.projects).where(inArray(schema.projects.id, part));
    return rows.length;
  }

  /** The files of the media removed more than 30 days ago: the rows and whatever is left on the disk. */
  private async purgeMedia(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION.deletedDays * DAY_MS);
    const rows = await this.db
      .select({ id: schema.media.id, ownerId: schema.media.ownerId, variants: schema.media.variants })
      .from(schema.media)
      .where(and(isNotNull(schema.media.deletedAt), lt(schema.media.deletedAt, cutoff), eq(schema.media.legalHold, false)));
    let count = 0;
    for (const m of rows) {
      try {
        await this.db.delete(schema.media).where(eq(schema.media.id, m.id));
      } catch {
        continue; // still referenced (a library item): stays until the reference goes
      }
      await this.removeFiles(m.ownerId, m.id, m.variants);
      count += 1;
    }
    return count;
  }

  /** Deleted accounts: after 30 days the account, its projects, files and sign-ins are removed for good. The consent of the user ends with it. */
  private async purgeAccounts(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION.deletedDays * DAY_MS);
    const users = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(isNotNull(schema.users.deletedAt), lt(schema.users.deletedAt, cutoff), eq(schema.users.legalHold, false)));
    let count = 0;
    for (const u of users) {
      const [held] = await this.db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.ownerId, u.id), eq(schema.projects.legalHold, true)))
        .limit(1);
      const [heldMedia] = await this.db
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(and(eq(schema.media.ownerId, u.id), eq(schema.media.legalHold, true)))
        .limit(1);
      if (held || heldMedia) continue;
      const files = await this.db.select({ id: schema.media.id, variants: schema.media.variants }).from(schema.media).where(eq(schema.media.ownerId, u.id));
      await this.db
        .update(schema.consentRecords)
        .set({ withdrawnAt: now })
        .where(and(eq(schema.consentRecords.subjectType, 'USER'), eq(schema.consentRecords.subjectId, u.id), isNull(schema.consentRecords.withdrawnAt)));
      try {
        await this.db.delete(schema.users).where(eq(schema.users.id, u.id));
      } catch {
        continue;
      }
      for (const f of files) await this.removeFiles(u.id, f.id, f.variants);
      count += 1;
    }
    return count;
  }

  /** The journal of consents: three years after the consent ended (withdrawn, or the subject deleted). */
  private async purgeConsents(now: Date): Promise<number> {
    const cutoff = yearsAgo(now, RETENTION.consentYearsAfter);
    const gone = await this.db
      .delete(schema.consentRecords)
      .where(and(isNotNull(schema.consentRecords.withdrawnAt), lt(schema.consentRecords.withdrawnAt, cutoff)))
      .returning({ id: schema.consentRecords.id });
    return gone.length;
  }

  private async purgeOrders(now: Date): Promise<number> {
    const cutoff = yearsAgo(now, RETENTION.ordersYears);
    const gone = await this.db
      .delete(schema.orders)
      .where(lt(sql`coalesce(${schema.orders.paidAt}, ${schema.orders.createdAt})`, cutoff))
      .returning({ id: schema.orders.id });
    return gone.length;
  }

  /** The base itself refuses to drop a row younger than three years by its own clock (AD-08), so the cutoff never goes past that. */
  private async purgeAudit(now: Date): Promise<number> {
    const cutoff = new Date(Math.min(yearsAgo(now, RETENTION.auditYears).getTime(), yearsAgo(new Date(), RETENTION.auditYears).getTime()));
    const gone = await this.db
      .delete(schema.auditLog)
      .where(lt(schema.auditLog.createdAt, cutoff))
      .returning({ id: schema.auditLog.id });
    return gone.length;
  }

  /** Sign-ins: the hash of the address and the device are kept for a year; a session record older than that goes whole. */
  private async purgeLogins(now: Date): Promise<number> {
    const gone = await this.db
      .delete(schema.sessions)
      .where(lt(schema.sessions.createdAt, yearsAgo(now, RETENTION.loginsYears)))
      .returning({ id: schema.sessions.id });
    return gone.length;
  }

  private async removeFiles(ownerId: string | null, mediaId: string, variants: unknown): Promise<void> {
    if (!this.storage || !ownerId) return;
    const keys = new Set<string>([`${ownerId}/${mediaId}`, servedKey(ownerId, mediaId, variants)]);
    for (const v of Object.values((variants ?? {}) as Record<string, unknown>)) {
      if (typeof v !== 'string') continue;
      const name = path.basename(v);
      if (name === mediaId || name.startsWith(`${mediaId}.`) || name.startsWith(`${mediaId}_`)) keys.add(`${ownerId}/${name}`);
    }
    for (const key of keys) await this.storage.delete(key);
  }
}
