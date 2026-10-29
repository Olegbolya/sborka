import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { DB } from '../tokens.js';

export interface RequestUser {
  id: string;
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  displayName: string;
  phoneE164: string | null;
}

export interface ValidSession {
  id: string;
  user: RequestUser;
}

export interface SessionListItem {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  uaFamily: string | null;
  isCurrent: boolean;
}

/** ASVS V3.3.2 (L1): a session ends after 14 days without use and in any case 30 days after the sign-in — then the person signs in again. */
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 14 * DAY_MS;
const SESSION_MAX_MS = 30 * DAY_MS;

/** HMAC-SHA256(IP, YYYY-MM-DD) — daily-rotating pseudonymisation per architecture §8.1. */
function hashIp(ip: string): string {
  const salt = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);
}

function parseUaFamily(ua: string): string | null {
  if (/\bChrome\//.test(ua) && !/\bEdg\//.test(ua)) return 'Chrome';
  if (/\bFirefox\//.test(ua)) return 'Firefox';
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return 'Safari';
  if (/\bOPR\//.test(ua) || /\bOpera\//.test(ua)) return 'Opera';
  return null;
}

/**
 * ASVS V3.4.4: over HTTPS the cookie carries the `__Host-` prefix (the browser then accepts it only with `Secure`, `Path=/` and
 * no `Domain`, and sends it only to the host that set it). Without HTTPS (development, tests) the prefix cannot be used.
 */
export const SESSION_COOKIE = 'session';
export const SESSION_COOKIE_SECURE = '__Host-session';

/** Parses `Cookie` header and returns the value of the session cookie (either name). */
export function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    const n = name?.trim();
    if (n === SESSION_COOKIE_SECURE || n === SESSION_COOKIE) return rest.join('=').trim() || null;
  }
  return null;
}

/** Formats a `Set-Cookie` header value for the session token (A-04). */
export function sessionCookieHeader(token: string, secure: boolean): string {
  const flags = `HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_MS / 1000}`;
  return `${secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE}=${token}; ${flags}${secure ? '; Secure' : ''}`;
}

/** Clears the session cookie (used on logout); over HTTPS both the prefixed name and the old plain one. */
export function clearSessionCookieHeader(secure: boolean): string | string[] {
  const clear = (name: string) => `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  return secure ? [clear(SESSION_COOKIE_SECURE), clear(SESSION_COOKIE)] : clear(SESSION_COOKIE);
}

@Injectable()
export class SessionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Creates a new session; returns the opaque token to set as cookie. */
  async create(userId: string, opts: { ip?: string; ua?: string } = {}): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_IDLE_MS);
    await this.db.insert(schema.sessions).values({
      userId,
      tokenHash,
      expiresAt,
      ipHash: opts.ip ? hashIp(opts.ip) : null,
      uaFamily: opts.ua ? parseUaFamily(opts.ua) : null,
    });
    return rawToken;
  }

  /** Validates token from cookie; extends expiry (sliding window up to the absolute limit). Returns null if invalid. */
  async validate(token: string): Promise<ValidSession | null> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const rows = await this.db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        and(
          eq(schema.sessions.tokenHash, tokenHash),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
          gt(schema.sessions.createdAt, new Date(now.getTime() - SESSION_MAX_MS)),
          ne(schema.users.status, 'BLOCKED'),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    await this.db
      .update(schema.sessions)
      // Sliding window, but never past the absolute limit counted from the sign-in.
      .set({ lastSeenAt: now, expiresAt: new Date(Math.min(now.getTime() + SESSION_IDLE_MS, row.session.createdAt.getTime() + SESSION_MAX_MS)) })
      .where(eq(schema.sessions.id, row.session.id));

    return {
      id: row.session.id,
      user: {
        id: row.user.id,
        role: row.user.role,
        status: row.user.status,
        displayName: row.user.displayName,
        phoneE164: row.user.phoneE164,
      },
    };
  }

  /** Revokes a single session (ownership checked). */
  /** Revokes one of the user's own sessions; `false` when there is no such session of theirs (somebody else's id is the same as none). */
  async revoke(sessionId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
      .returning({ id: schema.sessions.id });
    return rows.length > 0;
  }

  /** Revokes all active sessions for a user; optionally keeps the current one. */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<void> {
    const conds = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
    if (exceptSessionId) conds.push(ne(schema.sessions.id, exceptSessionId));
    await this.db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(...conds));
  }

  /** Lists active sessions for a user with a flag marking the current one. */
  async list(userId: string, currentSessionId: string): Promise<SessionListItem[]> {
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
      .orderBy(schema.sessions.lastSeenAt);
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      uaFamily: s.uaFamily,
      isCurrent: s.id === currentSessionId,
    }));
  }
}
