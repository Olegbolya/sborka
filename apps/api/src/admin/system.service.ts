import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, like, lt } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { type ApiConfig } from '../config.js';
import { type HealthProbes } from '../health/health.controller.js';
import { API_CONFIG, DB, HEALTH_PROBES } from '../tokens.js';
import { LegalLogsService } from './legal-logs.service.js';
import { ModerationService } from './moderation.service.js';

const MINUTE_MS = 60_000;

/** AD-09 · the state of the system for the front page of the admin: dependencies, queues, disk, backups, work waiting for people. */
@Injectable()
export class SystemService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(HEALTH_PROBES) private readonly probes: HealthProbes,
    private readonly moderation: ModerationService,
    private readonly legal: LegalLogsService,
  ) {}

  async state(now = new Date()) {
    const [database, redis, disk] = await Promise.all([this.probes.database().catch(() => false), this.probes.redis().catch(() => false), this.probes.diskUsedPct().catch(() => null)]);
    // The media queue lives in Redis; what it holds shows in the files waiting to be processed.
    const [waiting] = await this.db.select({ n: count() }).from(schema.media).where(inArray(schema.media.status, ['UPLOADED', 'PROCESSING']));
    const [stuck] = await this.db
      .select({ n: count() })
      .from(schema.media)
      .where(and(inArray(schema.media.status, ['UPLOADED', 'PROCESSING']), lt(schema.media.createdAt, new Date(now.getTime() - 10 * MINUTE_MS))));
    const [rejected] = await this.db
      .select({ n: count() })
      .from(schema.media)
      .where(and(eq(schema.media.status, 'REJECTED'), gte(schema.media.createdAt, new Date(now.getTime() - 24 * 60 * MINUTE_MS))));
    const [errors] = await this.db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(and(like(schema.auditLog.action, 'TOTP_FAILED%'), gte(schema.auditLog.createdAt, new Date(now.getTime() - 24 * 60 * MINUTE_MS))));
    return {
      version: this.config.version,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis, diskUsedPct: disk },
      diskWarning: disk !== null && disk > 85,
      queues: { mediaWaiting: waiting?.n ?? 0, mediaStuck: stuck?.n ?? 0, mediaRejected24h: rejected?.n ?? 0 },
      failedAdminLogins24h: errors?.n ?? 0,
      backups: await this.backups(),
      work: { ...(await this.moderation.counts(now)), legalOverdue: await this.legal.overdueCount(now) },
    };
  }

  /** The newest file in the backup directory (`BACKUP_DIR`), if the directory is set up. */
  private async backups(): Promise<{ configured: boolean; newest: { name: string; sizeBytes: number; at: Date } | null }> {
    const dir = this.config.backupDir;
    if (!dir) return { configured: false, newest: null };
    try {
      const files = await Promise.all((await readdir(dir)).map(async (name) => ({ name, info: await stat(join(dir, name)) })));
      const newest = files.filter((f) => f.info.isFile()).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0];
      return { configured: true, newest: newest ? { name: newest.name, sizeBytes: newest.info.size, at: newest.info.mtime } : null };
    } catch {
      return { configured: true, newest: null };
    }
  }

  /** AD-08 · the audit log, newest first; filters by the kind of target and by the beginning of the action name. */
  async audit(opts: { targetType?: unknown; targetId?: unknown; action?: unknown; limit?: unknown }) {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
    const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
    const targetType = str(opts.targetType);
    const targetId = str(opts.targetId);
    const action = str(opts.action);
    return this.db
      .select()
      .from(schema.auditLog)
      .where(and(targetType ? eq(schema.auditLog.targetType, targetType) : undefined, targetId ? eq(schema.auditLog.targetId, targetId) : undefined, action ? like(schema.auditLog.action, `${action.replace(/[%_\\]/g, '')}%`) : undefined))
      .orderBy(desc(schema.auditLog.id))
      .limit(limit);
  }
}
