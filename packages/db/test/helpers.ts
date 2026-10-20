import { createId } from '@blokum/schema';
import pg from 'pg';
import { createDb, type DbHandle } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

/** Base connection for tests: CI service / local `pnpm services` (scripts/dev-services.sh). */
export const TEST_BASE_URL = process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test';

export interface TestDb extends DbHandle {
  url: string;
  drop(): Promise<void>;
}

/** Creates an isolated empty database (optionally migrated) so test files can run in parallel. */
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `blokum_t_${createId(12)}`;
  const admin = new pg.Client({ connectionString: TEST_BASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const url = new URL(TEST_BASE_URL);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString(), { max: 4, applicationName: 'blokum-test' });
  if (options.migrate !== false) await runMigrations(handle.db);
  return {
    ...handle,
    url: url.toString(),
    async drop() {
      await handle.close();
      const c = new pg.Client({ connectionString: TEST_BASE_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}
