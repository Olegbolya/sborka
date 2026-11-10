import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { AuditLogService } from '../auth/audit-log.service.js';
import { API_CONFIG, DB } from '../tokens.js';
import { type ApiConfig } from '../config.js';
import { fail } from './errors.js';

export type IdentityKind = 'PHONE' | 'VK' | 'YANDEX';
type Conn = Pick<Db, 'select' | 'insert' | 'delete'>;

/** The same words for every denial: a blocked person is not told which identifier gave them away (docs/06-TRUST-SAFETY.md §5). */
export const BLOCKED_MESSAGE = 'Вход и регистрация с этими данными закрыты. Если вы считаете, что это ошибка, напишите в поддержку.';

/**
 * P9.2 · TS-31, TS-32 · a blocked account cannot come back through the same phone or the same VK / Яндекс account — not with its own
 * login, not with a new registration, not by binding the identifier to another account. Only keyed hashes are kept, and by
 * identifiers, never by a fingerprint of the browser.
 */
@Injectable()
export class BlockedIdentitiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly audit: AuditLogService,
  ) {}

  hash(kind: IdentityKind, value: string): string {
    return createHmac('sha256', this.config.totpSecretKey).update(`blocked-identity:${kind}:${value.trim()}`).digest('hex');
  }

  /** The block of an account: its phone and its VK / Яндекс identifiers are put on the list. */
  async block(conn: Conn, userId: string): Promise<void> {
    const [user] = await conn.select({ phone: schema.users.phoneE164 }).from(schema.users).where(eq(schema.users.id, userId));
    const identities = await conn.select({ provider: schema.authIdentities.provider, providerUserId: schema.authIdentities.providerUserId }).from(schema.authIdentities).where(eq(schema.authIdentities.userId, userId));
    const rows: Array<{ kind: IdentityKind; hash: string; userId: string }> = [];
    if (user?.phone) rows.push({ kind: 'PHONE', hash: this.hash('PHONE', user.phone), userId });
    for (const i of identities) rows.push({ kind: i.provider === 'VK' ? 'VK' : 'YANDEX', hash: this.hash(i.provider === 'VK' ? 'VK' : 'YANDEX', i.providerUserId), userId });
    if (rows.length > 0) await conn.insert(schema.blockedIdentities).values(rows).onConflictDoNothing();
  }

  /** The block is lifted: the identifiers are free again. */
  async release(conn: Conn, userId: string): Promise<void> {
    await conn.delete(schema.blockedIdentities).where(eq(schema.blockedIdentities.userId, userId));
  }

  /** The blocked account an identifier belongs to, if any. */
  async find(kind: IdentityKind, value: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ userId: schema.blockedIdentities.userId })
      .from(schema.blockedIdentities)
      .where(and(eq(schema.blockedIdentities.kind, kind), eq(schema.blockedIdentities.hash, this.hash(kind, value))))
      .limit(1);
    return row?.userId;
  }

  /**
   * Stops the entry when the identifier is on the list: a block is lifted by removing the rows, so whoever is on the list is
   * blocked, and neither the account itself nor any other may use the identifier.
   * The attempt is written to the audit log with the blocked account's id (TS-32: the moderators see who came back).
   */
  async assertFree(kind: IdentityKind, value: string, what: 'LOGIN' | 'REGISTRATION' | 'LINK', ip?: string): Promise<void> {
    const blockedUserId = await this.find(kind, value);
    if (!blockedUserId) return;
    await this.audit.log({ actorId: blockedUserId, action: 'BLOCKED_IDENTITY_DENIED', targetType: 'user', targetId: blockedUserId, ...(ip ? { ip } : {}), meta: { kind, attempt: what } });
    throw fail(403, 'ACCOUNT_BLOCKED', BLOCKED_MESSAGE);
  }
}
