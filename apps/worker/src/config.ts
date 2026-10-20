export interface WorkerConfig {
  redisUrl: string;
  /** Prefix of every Redis key of Блокум (docs/02-ARCHITECTURE.md §3: DB 3, prefix `bk:`). */
  keyPrefix: string;
  heartbeatIntervalMs: number;
  /** Partitions watched for free space (docs/02-ARCHITECTURE.md §9): data root and the system disk. */
  diskPaths: string[];
  diskCheckIntervalMs: number;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const redisUrl = env.REDIS_URL ?? 'redis://127.0.0.1:6379/3';
  if (!/^rediss?:\/\//.test(redisUrl)) throw new Error('REDIS_URL должен начинаться с redis:// или rediss://');
  const interval = Number(env.WORKER_HEARTBEAT_MS ?? 10_000);
  if (!Number.isInteger(interval) || interval < 1000) throw new Error('WORKER_HEARTBEAT_MS — целое число не меньше 1000');
  const dataRoot = env.DATA_ROOT ?? '/';
  return {
    redisUrl,
    keyPrefix: 'bk:',
    heartbeatIntervalMs: interval,
    diskPaths: [...new Set([dataRoot, '/'])],
    diskCheckIntervalMs: 10 * 60_000,
  };
}
