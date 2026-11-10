import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { NotificationsService } from '../admin/notifications.service.js';
import { DB } from '../tokens.js';

/** The yearly limit of the income of a self-employed person (05-LEGAL §2.12); the administrator can change it. */
export const NPD_LIMIT_RUB_DEFAULT = 2_400_000;
const LIMIT_KEY = 'npd_limit_rub';
/** The rate of the tax on professional income: 4 % on payments of people, 6 % on payments of companies and sole traders. */
export const NPD_RATE = { PERSON: 0.04, BUSINESS: 0.06 } as const;
/** AD-12: the administrator is warned at these shares of the limit. */
export const NPD_THRESHOLDS = [80, 95] as const;
const MOSCOW_OFFSET_MS = 3 * 3_600_000;

/** The first moment of the year in Moscow (the tax year of the person starts on January 1 local time). */
export const yearStart = (now: Date): Date => new Date(Date.UTC(new Date(now.getTime() + MOSCOW_OFFSET_MS).getUTCFullYear(), 0, 1) - MOSCOW_OFFSET_MS);
const yearOf = (now: Date): number => new Date(now.getTime() + MOSCOW_OFFSET_MS).getUTCFullYear();

export interface IncomeView {
  year: number;
  limitKop: number;
  personKop: number;
  businessKop: number;
  totalKop: number;
  /** The tax that follows from the sums: 4 % of the first, 6 % of the second. */
  taxKop: number;
  /** Share of the limit, in percent with one decimal. */
  percent: number;
  /** The thresholds already reached. */
  reached: number[];
}

/** AD-12 · the income of the self-employed since January 1 against the yearly limit, and the warnings at 80 % and 95 %. */
@Injectable()
export class NpdIncomeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly notices?: NotificationsService,
  ) {}

  async limitRub(): Promise<number> {
    const [row] = await this.db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, LIMIT_KEY));
    return typeof row?.value === 'number' && row.value > 0 ? row.value : NPD_LIMIT_RUB_DEFAULT;
  }

  /** Money that came in since January 1: paid orders with a price, without returns; free orders (promo, by hand) are not income. */
  async income(now = new Date()): Promise<IncomeView> {
    const rows = await this.db
      .select({ payerType: schema.orders.payerType, sum: sql<number>`coalesce(sum(${schema.orders.amountKop}), 0)::bigint` })
      .from(schema.orders)
      .where(and(eq(schema.orders.status, 'PAID'), gt(schema.orders.amountKop, 0), ne(schema.orders.provider, 'manual'), ne(schema.orders.provider, 'promo'), sql`${schema.orders.paidAt} >= ${yearStart(now)}`))
      .groupBy(schema.orders.payerType);
    const personKop = Number(rows.find((r) => r.payerType === 'PERSON')?.sum ?? 0);
    const businessKop = Number(rows.find((r) => r.payerType === 'BUSINESS')?.sum ?? 0);
    const totalKop = personKop + businessKop;
    const limitKop = (await this.limitRub()) * 100;
    const percent = Math.round((totalKop / limitKop) * 1000) / 10;
    return {
      year: yearOf(now),
      limitKop,
      personKop,
      businessKop,
      totalKop,
      taxKop: Math.round(personKop * NPD_RATE.PERSON + businessKop * NPD_RATE.BUSINESS),
      percent,
      reached: NPD_THRESHOLDS.filter((t) => (totalKop / limitKop) * 100 >= t),
    };
  }

  /**
   * Warns every administrator once a year per threshold (80 % and 95 %) when the income reaches it. «Once» is kept by the
   * notification itself: its kind carries the threshold and the year, so a second payment does not repeat the warning.
   */
  async checkLimit(now = new Date()): Promise<number[]> {
    if (!this.notices) return [];
    const view = await this.income(now);
    const sent: number[] = [];
    for (const threshold of view.reached) {
      const kind = `npd-${threshold}:${view.year}`;
      const [done] = await this.db.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.kind, kind)).limit(1);
      if (done) continue;
      const admins = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'ADMIN'));
      const rub = (kop: number): string => `${new Intl.NumberFormat('ru-RU').format(Math.round(kop / 100))} ₽`;
      for (const a of admins) {
        await this.notices
          .notify({
            userId: a.id,
            kind,
            title: `Доход самозанятого: ${threshold} % годового лимита`,
            body: `С 1 января ${view.year} года поступило ${rub(view.totalKop)} из ${rub(view.limitKop)} (${view.percent} %). Физлица: ${rub(view.personKop)}, юрлица и ИП: ${rub(view.businessKop)}. При подходе к лимиту заранее открывайте ИП и переходите на онлайн-кассу провайдера (docs/05-LEGAL.md §2.12).`,
          })
          .catch(() => undefined);
      }
      sent.push(threshold);
    }
    return sent;
  }

  async saveLimit(actorId: string, rub: number): Promise<void> {
    await this.db
      .insert(schema.appSettings)
      .values({ key: LIMIT_KEY, value: rub, updatedById: actorId })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: rub, updatedAt: new Date(), updatedById: actorId } });
  }
}
