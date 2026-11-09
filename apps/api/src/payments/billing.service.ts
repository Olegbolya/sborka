import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

export interface BillingState {
  plan: { code: string; title: string };
  subscription: { planCode: string; status: string; trial: boolean; currentPeriodEnd: Date; renewMode: 'AUTO' | 'LINK' } | null;
  /** Пробный период уже использован: он один на человека. */
  trialUsed: boolean;
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
    };
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
