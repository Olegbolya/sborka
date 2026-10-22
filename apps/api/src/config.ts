export interface ApiConfig {
  port: number;
  host: string;
  version: string;
  databaseUrl: string;
  redisUrl: string;
  dataRoot: string;
  /** A-04: origins allowed to make mutating requests (CSRF check). */
  allowedOrigins: string[];
}

const DEV_DATABASE_URL = 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_dev';
const DEV_REDIS_URL = 'redis://127.0.0.1:6379/3';

/** Reads API settings from the environment; fails fast on invalid values. Production requires explicit URLs. */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = env.API_PORT ?? env.PORT ?? '3100';
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Неверный порт API: «${port}»`);
  }
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL ?? (production ? undefined : DEV_DATABASE_URL);
  const redisUrl = env.REDIS_URL ?? (production ? undefined : DEV_REDIS_URL);
  if (!databaseUrl) throw new Error('Не задан DATABASE_URL (в рабочей среде он обязателен)');
  if (!redisUrl) throw new Error('Не задан REDIS_URL (в рабочей среде он обязателен)');
  const rawOrigins = env.ALLOWED_ORIGINS ?? `http://localhost:3110`;
  return {
    port: parsed,
    host: env.API_HOST ?? '127.0.0.1',
    version: env.APP_VERSION ?? 'dev',
    databaseUrl,
    redisUrl,
    dataRoot: env.DATA_ROOT ?? '/',
    allowedOrigins: rawOrigins.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
