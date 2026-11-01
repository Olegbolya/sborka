import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { loadSystemTemplates } from '@blokum/themes';
import { DB } from '../tokens.js';

/**
 * TPL-03 · seeds the starter system templates on API startup. The 14 shipped documents
 * (`@blokum/themes` → `loadSystemTemplates()`) are inserted into the `templates` table with
 * stable ids so the «Новая сборка» wizard (P10.2) always has a baseline. Idempotent: existing
 * rows stay as the administrator left them; only missing ids are inserted. More system
 * templates may be published through AD-11 later.
 */
@Injectable()
export class SystemTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(SystemTemplatesService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    if (typeof (this.db as unknown as Record<string, unknown>)['select'] !== 'function') return;
    await this.seed();
  }

  /** Inserts missing system templates; returns the number of rows actually inserted. */
  async seed(): Promise<number> {
    const definitions = loadSystemTemplates();
    let inserted = 0;
    for (const def of definitions) {
      const existing = await this.db
        .select({ id: schema.templates.id })
        .from(schema.templates)
        .where(and(eq(schema.templates.id, def.id), eq(schema.templates.isSystem, true)))
        .limit(1);
      if (existing[0]) continue;
      await this.db
        .insert(schema.templates)
        .values({
          id: def.id,
          ownerId: null,
          name: def.name,
          category: def.category,
          document: def.document,
          isSystem: true,
          sort: def.sort,
          publishedAt: new Date(),
        })
        .onConflictDoNothing();
      inserted += 1;
    }
    if (inserted > 0) this.logger.log(`TPL-03: добавлено системных шаблонов — ${inserted}`);
    return inserted;
  }
}
