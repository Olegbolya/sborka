import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, isNull, sql, sum } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

export interface BillingState {
  plan: { code: string; title: string };
  subscription: { planCode: string; status: string; trial: boolean; currentPeriodEnd: Date; renewMode: 'AUTO' | 'LINK' } | null;
  /** Пробный период уже использован: он один на человека. */
  trialUsed: boolean;
  /** D-09 · расход лимитов тарифа: прохождения с начала месяца (по всем сборкам) и место под файлы. */
  usage: { completions: number; completionsLimit: number; storageBytes: number; storageLimit: number };
  /** D-09 · действующие пропуска «Праздник»: сборка и последний день. */
  passes: Array<{ projectId: string; title: string; validTo: Date }>;
}

/** P7.4 · состояние подписки человека и пробный период без карты (ADR-048). */
@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly entitlements: EntitlementsService,
  ) {}

  async state(userId: string, now: Date = new Date()): Promise<BillingState> {
    const plan = await this.entitlements.planOf(userId, now);
    const [latest] = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .orderBy(desc(schema.subscriptions.currentPeriodEnd))
      .limit(1);
    const [trial] = await this.db.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.trial, true))).limit(1);
    return {
      plan: { code: plan.code, title: plan.title },
      subscription: latest ? { planCode: latest.planCode, status: latest.status, trial: latest.trial, currentPeriodEnd: latest.currentPeriodEnd, renewMode: latest.renewMode } : null,
      trialUsed: Boolean(trial),
      usage: await this.usage(userId, plan.limits, now),
      passes: await this.db
        .selectDistinctOn([schema.entitlements.projectId], { projectId: schema.entitlements.projectId, title: schema.projects.title, validTo: schema.entitlements.validTo })
        .from(schema.entitlements)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.entitlements.projectId))
        .where(and(eq(schema.entitlements.userId, userId), eq(schema.entitlements.feature, 'PASS'), gt(schema.entitlements.validTo, now), isNull(schema.projects.deletedAt)))
        .orderBy(schema.entitlements.projectId, desc(schema.entitlements.validTo))
        .then((rows) => rows.map((x) => ({ projectId: x.projectId!, title: x.title, validTo: x.validTo! })).sort((a, b) => a.validTo.getTime() - b.validTo.getTime())),
    };
  }

  /** Тот же счёт, что у лимита при старте прохождения (play.service) и у квоты файлов (media.service). */
  private async usage(userId: string, limits: { completionsPerMonth: number; storageBytes: number }, now: Date): Promise<BillingState['usage']> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [month] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.participantSessions)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.participantSessions.projectId))
      .where(and(eq(schema.projects.ownerId, userId), eq(schema.participantSessions.isPreview, false), gte(schema.participantSessions.startedAt, monthStart)));
    const [files] = await this.db.select({ total: sum(schema.media.bytes) }).from(schema.media).where(and(eq(schema.media.ownerId, userId), isNull(schema.media.deletedAt)));
    return { completions: month?.n ?? 0, completionsLimit: limits.completionsPerMonth, storageBytes: Number(files?.total ?? 0), storageLimit: limits.storageBytes };
  }

  /** Пробный период: без карты, один раз на человека, только на тарифах, где он задан (`trialDays`). Потом ничего не списывается. */
  async startTrial(userId: string, planCode: unknown, now: Date = new Date()): Promise<BillingState> {
    const [plan] = await this.db.select().from(schema.plans).where(and(eq(schema.plans.code, typeof planCode === 'string' ? planCode : ''), eq(schema.plans.public, true)));
    const days = plan?.limits.trialDays ?? 0;
    if (!plan || days <= 0) throw fail(400, 'TRIAL_UNAVAILABLE', 'Для этого тарифа пробного периода нет.');
    const current = await this.entitlements.planOf(userId, now);
    if (current.code !== 'FREE') throw fail(409, 'TRIAL_NOT_NEEDED', 'У вас уже действует платный тариф.');
    await this.db.transaction(async (tx) => {
      // Блокировка по человеку: две одновременные заявки не создают два пробных периода.
      await tx.execute(sqlLock(userId));
      const [used] = await tx.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.trial, true))).limit(1);
      if (used) throw fail(409, 'TRIAL_USED', 'Пробный период уже был использован. Оформите подписку.');
      await tx.insert(schema.subscriptions).values({
        userId,
        planCode: plan.code,
        period: 'MONTH',
        status: 'TRIAL',
        trial: true,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + days * 86_400_000),
      });
    });
    return this.state(userId, now);
  }
}

const sqlLock = (userId: string) => sql`select pg_advisory_xact_lock(hashtext(${'trial:' + userId}))`;
