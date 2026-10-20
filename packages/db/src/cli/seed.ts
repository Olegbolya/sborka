import { createDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedDevData, seedPlans } from '../seed.js';

const handle = createDb(process.env.DATABASE_URL, { max: 1, applicationName: 'blokum-seed' });
try {
  await runMigrations(handle.db);
  await seedPlans(handle.db);
  await seedDevData(handle.db);
  console.warn('Тестовые данные загружены');
} finally {
  await handle.close();
}
