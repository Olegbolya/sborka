import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { parseDatabaseUrl } from './database-url.js';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Creates a connection pool and a typed Drizzle client. Validates the URL first (127.0.0.1, not localhost). */
export function createDb(url: string | undefined, options: { max?: number; applicationName?: string } = {}): DbHandle {
  parseDatabaseUrl(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'blokum',
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** PostgreSQL error codes that mean «retry the whole transaction». */
const RETRYABLE = new Set(['40001', '40P01']);

const errorCode = (e: unknown): string | undefined => {
  const direct = (e as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (e as { cause?: { code?: unknown } }).cause?.code;
  return typeof cause === 'string' ? cause : undefined;
};

/**
 * Runs `fn` in a transaction; on serialization failure or deadlock retries up to `retries` times.
 * Any other error rolls back and is rethrown unchanged.
 */
export async function withTransaction<T>(
  db: Pick<Db, 'transaction'>,
  fn: (tx: Tx) => Promise<T>,
  options: { retries?: number; isolationLevel?: 'read committed' | 'repeatable read' | 'serializable' } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(fn, options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined);
    } catch (e) {
      const code = errorCode(e);
      if (code && RETRYABLE.has(code) && attempt < retries) continue;
      throw e;
    }
  }
}

/** Liveness check for /api/v1/health: true if the database answers `SELECT 1`. */
export async function checkDatabase(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
