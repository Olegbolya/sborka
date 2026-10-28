import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type Alerts } from '@blokum/observability';
import { type Db, schema } from '@blokum/db';
import { FEATURE_FLAGS, type FeatureFlagKey } from '@blokum/schema';
import { AuditLogService } from '../auth/audit-log.service.js';
import { ALERTS, DB } from '../tokens.js';
import { fail } from './errors.js';

const CACHE_MS = 30_000;

export interface FlagView {
  key: FeatureFlagKey;
  label: string;
  enabled: boolean;
  note: string;
  updatedAt: Date | null;
  updatedById: string | null;
}

/**
 * AD-07 · emergency switches (docs/06-TRUST-SAFETY.md §7). A switch that was never touched is on. The values are read from the
 * database at most once in 30 seconds, so a switch works without a restart and the hot paths do not ask the database every time.
 */
@Injectable()
export class FeatureFlagsService {
  private cache: { at: number; values: Map<string, boolean> } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ALERTS) private readonly alerts: Alerts,
    private readonly audit: AuditLogService,
  ) {}

  private async values(now: number): Promise<Map<string, boolean>> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.values;
    const rows = await this.db.select({ key: schema.featureFlags.key, enabled: schema.featureFlags.enabled }).from(schema.featureFlags);
    this.cache = { at: now, values: new Map(rows.map((r) => [r.key, r.enabled])) };
    return this.cache.values;
  }

  async isEnabled(key: FeatureFlagKey, now = Date.now()): Promise<boolean> {
    return (await this.values(now)).get(key) ?? true;
  }

  /** Stops the request with a Russian message when the switch is off. */
  async require(key: FeatureFlagKey, message: string): Promise<void> {
    if (!(await this.isEnabled(key))) throw fail(503, 'FEATURE_DISABLED', message);
  }

  async list(): Promise<FlagView[]> {
    const rows = await this.db.select().from(schema.featureFlags);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return FEATURE_FLAGS.map((f) => {
      const row = byKey.get(f.key);
      return { key: f.key, label: f.label, enabled: row?.enabled ?? true, note: row?.note ?? '', updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
    });
  }

  async set(key: string, enabled: boolean, note: string, actorId: string, ip?: string): Promise<FlagView> {
    const flag = FEATURE_FLAGS.find((f) => f.key === key);
    if (!flag) throw fail(404, 'NOT_FOUND', 'Такого выключателя нет');
    if (!enabled && note.trim().length < 3) throw fail(422, 'NOTE_REQUIRED', 'Напишите, почему выключаете: хотя бы пара слов.');
    const now = new Date();
    await this.db
      .insert(schema.featureFlags)
      .values({ key, enabled, note: note.trim(), updatedAt: now, updatedById: actorId })
      .onConflictDoUpdate({ target: schema.featureFlags.key, set: { enabled, note: note.trim(), updatedAt: now, updatedById: actorId } });
    this.cache = null;
    await this.audit.log({ actorId, action: enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED', targetType: 'FEATURE_FLAG', targetId: key, ...(ip ? { ip } : {}), meta: { note: note.trim() } });
    // §7: every switch is told to the owner.
    await this.alerts.raise(`feature-flag:${key}`, `Выключатель «${flag.label}»: ${enabled ? 'включён' : 'выключен'}`, note.trim() || undefined, enabled ? 'warning' : 'critical');
    const [row] = await this.db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, key));
    return { key: flag.key, label: flag.label, enabled: row!.enabled, note: row!.note, updatedAt: row!.updatedAt, updatedById: row!.updatedById };
  }
}
