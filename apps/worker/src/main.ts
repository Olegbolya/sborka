import { createAlertsFromEnv, createLogger } from '@blokum/observability';
import { Redis } from 'ioredis';
import { createDb } from '@blokum/db';
import { loadWorkerConfig } from './config.js';
import { startHeartbeat } from './heartbeat.js';
import { startDiskWatch } from './monitoring.js';
import { startMediaProcessor } from './media/processor.js';

const config = loadWorkerConfig();
const logger = createLogger({ service: 'blokum-worker' });
const alerts = createAlertsFromEnv(process.env, { logger });
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
redis.on('error', (e) => logger.warn({ err: e }, 'Redis недоступен'));

const heartbeat = startHeartbeat(redis, {
  keyPrefix: config.keyPrefix,
  intervalMs: config.heartbeatIntervalMs,
  onError: (e) => logger.error({ err: e }, 'Не удалось записать heartbeat воркера'),
});
await heartbeat.beat();
const disks = startDiskWatch({ paths: config.diskPaths, alerts, logger, intervalMs: config.diskCheckIntervalMs });

const dbHandle = createDb(config.databaseUrl, { applicationName: 'blokum-worker', max: 4 });

const redisUrl = new URL(config.redisUrl);
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  db: Number(redisUrl.pathname.slice(1)) || 0,
};
const mediaWorker = startMediaProcessor({
  connection: redisConnection,
  mediaDir: config.mediaDir,
  quarantineDir: config.quarantineDir,
  db: dbHandle.db,
  logger,
});

// Keep the process alive between timers (the timers themselves are unref'd so tests can exit).
const keepAlive = setInterval(() => undefined, 60_000);
logger.info('Воркер Блокума запущен');

const shutdown = async (): Promise<void> => {
  clearInterval(keepAlive);
  disks.stop();
  await heartbeat.stop();
  await mediaWorker.close();
  await dbHandle.close();
  await redis.quit();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
