import { createRequire } from 'node:module';
import path from 'node:path';

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

/**
 * Подписка владельцу сборки напрямую в базе e2e: тест проверяет лимит сборки (например, 50 стартов),
 * а не месячный лимит тарифа «Старт», поэтому у владельца действует платный тариф.
 */
export async function subscribeOwner(projectId: string, planCode = 'PLUS'): Promise<void> {
  const requireFromDb = createRequire(path.resolve(process.cwd(), 'packages/db/package.json'));
  const { Client } = requireFromDb('pg') as { Client: new (config: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test' });
  await client.connect();
  try {
    const owner = await client.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
    const userId = owner.rows[0]?.owner_id;
    if (typeof userId !== 'string') throw new Error(`Не найден владелец сборки ${projectId}`);
    await client.query(
      `INSERT INTO subscriptions (id, user_id, plan_code, period, status, current_period_start, current_period_end)
       VALUES (gen_random_uuid()::text, $1, $2, 'MONTH', 'ACTIVE', now() - interval '1 day', now() + interval '29 days')`,
      [userId, planCode],
    );
  } finally {
    await client.end();
  }
}
