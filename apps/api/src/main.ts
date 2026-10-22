import { checkDatabase, createDb } from '@blokum/db';
import { createAlertsFromEnv, createLogger, diskUsagePercent } from '@blokum/observability';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig();
const logger = createLogger({ service: 'blokum-api', version: config.version });
const alerts = createAlertsFromEnv(process.env, { logger });
const db = createDb(config.databaseUrl, { applicationName: 'blokum-api' });
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
redis.on('error', (e) => logger.warn({ err: e }, 'Redis недоступен'));
await redis.connect().catch((e: unknown) => logger.error({ err: e }, 'Не удалось подключиться к Redis'));

const app = await createApp(config, {
  logger,
  alerts,
  db: db.db,
  probes: {
    database: () => checkDatabase(db.db),
    redis: async () => (await redis.ping()) === 'PONG',
    diskUsedPct: () => diskUsagePercent(config.dataRoot),
  },
});
app.enableShutdownHooks();
process.once('beforeExit', () => {
  void db.close();
  redis.disconnect();
});
await app.listen(config.port, config.host);
logger.info({ port: config.port }, 'API Блокума запущен');
