import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabase } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import * as schema from '../src/schema/index.js';
import { getTableName, isTable } from 'drizzle-orm';
import { createTestDb, type TestDb } from './helpers.js';

describe('миграции', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrate: false });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('применяются к пустой базе и создают все таблицы схемы', async () => {
    await runMigrations(t.db);
    const rows = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const actual = new Set(rows.rows.map((r) => r.table_name));
    const expected = Object.values(schema)
      .filter((v) => isTable(v))
      .map((tbl) => getTableName(tbl));
    expect(expected.length).toBe(36);
    for (const name of expected) expect(actual, `нет таблицы ${name}`).toContain(name);
  });

  it('повторный запуск ничего не ломает', async () => {
    await runMigrations(t.db);
    await runMigrations(t.db);
    const applied = await t.db.execute<{ n: string }>(sql`select count(*)::text as n from drizzle.__drizzle_migrations`);
    expect(Number(applied.rows[0]?.n)).toBe(4);
  });

  it('checkDatabase отвечает true для живой базы и false для недоступной', async () => {
    expect(await checkDatabase(t.db)).toBe(true);
    const { createDb } = await import('../src/client.js');
    const dead = createDb('postgresql://nobody:x@127.0.0.1:1/none', { max: 1 });
    expect(await checkDatabase(dead.db)).toBe(false);
    await dead.close();
  });
});
