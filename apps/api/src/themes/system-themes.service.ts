import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { SYSTEM_THEMES } from '@blokum/themes';
import { DB } from '../tokens.js';

/**
 * TH-05 · seeds the three baseline system themes on API startup. Idempotent: fixed ids plus
 * ON CONFLICT DO NOTHING, so repeated startups do not duplicate rows. If an administrator later
 * publishes more system themes through AD-11 (apps/api/src/admin/system-content.service.ts),
 * those rows coexist with the ones seeded here.
 */
@Injectable()
export class SystemThemesService implements OnModuleInit {
  private readonly logger = new Logger(SystemThemesService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    // Allow unit tests to construct the service with a stub DB.
    if (typeof (this.db as unknown as Record<string, unknown>)['select'] !== 'function') return;
    await this.seed();
  }

  /** Inserts missing system themes; returns the number of rows actually inserted. */
  async seed(): Promise<number> {
    let inserted = 0;
    for (const theme of SYSTEM_THEMES) {
      const existing = await this.db
        .select({ id: schema.themes.id })
        .from(schema.themes)
        .where(and(eq(schema.themes.id, theme.id), eq(schema.themes.isSystem, true)))
        .limit(1);
      if (existing[0]) continue;
      await this.db
        .insert(schema.themes)
        .values({
          id: theme.id,
          ownerId: null,
          name: theme.name,
          tokens: theme.tokens,
          isSystem: true,
          publishedAt: new Date(),
        })
        .onConflictDoNothing();
      inserted += 1;
    }
    if (inserted > 0) this.logger.log(`TH-05: добавлено системных тем — ${inserted}`);
    return inserted;
  }
}
