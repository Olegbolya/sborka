import { Controller, Get, Inject } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { Public } from '../auth/decorators.js';
import { DB } from '../tokens.js';

/** One plan as the landing and the tariffs page show it (the limits are the same ones `Entitlements` enforces). */
export interface PlanDto {
  code: string;
  title: string;
  priceMonthRub: number | null;
  priceYearRub: number | null;
  priceOnceRub: number | null;
  limits: typeof schema.plans.$inferSelect.limits;
}

/** P10.1 · the public list of plans: what is on the site always comes from the table, never from a copy in the pages. */
@Public()
@Controller('plans')
export class PlansController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(): Promise<{ plans: PlanDto[] }> {
    const rows = await this.db.select().from(schema.plans).where(eq(schema.plans.public, true)).orderBy(asc(schema.plans.sort));
    return {
      plans: rows.map((p) => ({ code: p.code, title: p.title, priceMonthRub: p.priceMonthRub, priceYearRub: p.priceYearRub, priceOnceRub: p.priceOnceRub, limits: p.limits })),
    };
  }
}
