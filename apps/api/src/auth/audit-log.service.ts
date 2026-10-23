import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Db, schema } from '@blokum/db';
import { DB } from '../tokens.js';

export interface AuditLogEntry {
  actorId?: string;
  action: string;
  targetType: string;
  targetId: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

/** AD-08: append-only audit log — no update or delete methods. */
@Injectable()
export class AuditLogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(entry: AuditLogEntry): Promise<void> {
    if (typeof (this.db as unknown as Record<string, unknown>)['insert'] !== 'function') return;
    const ipHash = entry.ip ? createHash('sha256').update(entry.ip).digest('hex').slice(0, 16) : null;
    await this.db.insert(schema.auditLog).values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      ipHash,
      meta: entry.meta ?? {},
    });
  }
}
