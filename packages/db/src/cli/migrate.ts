import { createDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedPlans } from '../seed.js';

const handle = createDb(process.env.DATABASE_URL, { max: 1, applicationName: 'blokum-migrate' });
try {
  await runMigrations(handle.db);
  const created = await seedPlans(handle.db);
  console.warn(`Миграции применены; новых тарифов: ${created}`);
} finally {
  await handle.close();
}
