import { Redis } from 'ioredis';
import { loadWorkerConfig } from './config.js';
import { startHeartbeat } from './heartbeat.js';

const config = loadWorkerConfig();
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const heartbeat = startHeartbeat(redis, {
  keyPrefix: config.keyPrefix,
  intervalMs: config.heartbeatIntervalMs,
  onError: (e) => console.error('Не удалось записать heartbeat воркера', e),
});
await heartbeat.beat();
// Keep the process alive between heartbeats (the timer itself is unref'd so tests can exit).
const keepAlive = setInterval(() => undefined, 60_000);
console.warn('Воркер Блокума запущен');

const shutdown = async (): Promise<void> => {
  clearInterval(keepAlive);
  await heartbeat.stop();
  await redis.quit();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
