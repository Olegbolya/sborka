export interface WorkerConfig {
  redisUrl: string;
  /** Prefix of every Redis key of Блокум (docs/02-ARCHITECTURE.md §3: DB 3, prefix `bk:`). */
  keyPrefix: string;
  heartbeatIntervalMs: number;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const redisUrl = env.REDIS_URL ?? 'redis://127.0.0.1:6379/3';
  if (!/^rediss?:\/\//.test(redisUrl)) throw new Error('REDIS_URL должен начинаться с redis:// или rediss://');
  const interval = Number(env.WORKER_HEARTBEAT_MS ?? 10_000);
  if (!Number.isInteger(interval) || interval < 1000) throw new Error('WORKER_HEARTBEAT_MS — целое число не меньше 1000');
  return { redisUrl, keyPrefix: 'bk:', heartbeatIntervalMs: interval };
}
