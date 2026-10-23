export interface WorkerConfig {
  redisUrl: string;
  /** Prefix of every Redis key of Блокум (docs/02-ARCHITECTURE.md §3: DB 3, prefix `bk:`). */
  keyPrefix: string;
  heartbeatIntervalMs: number;
  /** Partitions watched for free space (docs/02-ARCHITECTURE.md §9): data root and the system disk. */
  diskPaths: string[];
  diskCheckIntervalMs: number;
  databaseUrl: string;
  /** P4.3: directory where processed media is stored. */
  mediaDir: string;
  /** P4.3: directory for quarantined (infected) files (TS-21). */
  quarantineDir: string;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const redisUrl = env.REDIS_URL ?? 'redis://127.0.0.1:6379/3';
  if (!/^rediss?:\/\//.test(redisUrl)) throw new Error('REDIS_URL должен начинаться с redis:// или rediss://');
  const interval = Number(env.WORKER_HEARTBEAT_MS ?? 10_000);
  if (!Number.isInteger(interval) || interval < 1000) throw new Error('WORKER_HEARTBEAT_MS — целое число не меньше 1000');
  const dataRoot = env.DATA_ROOT ?? '/';
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL ?? (production ? undefined : 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_dev');
  if (!databaseUrl) throw new Error('Не задан DATABASE_URL (в рабочей среде он обязателен)');
  return {
    redisUrl,
    keyPrefix: 'bk:',
    heartbeatIntervalMs: interval,
    diskPaths: [...new Set([dataRoot, '/'])],
    diskCheckIntervalMs: 10 * 60_000,
    databaseUrl,
    mediaDir: env.MEDIA_DIR ?? (production ? '/srv/blokum/media' : `${env.DATA_ROOT ?? '/tmp'}/blokum-media`),
    quarantineDir: env.QUARANTINE_DIR ?? (production ? '/srv/blokum/quarantine' : `${env.DATA_ROOT ?? '/tmp'}/blokum-quarantine`),
  };
}
