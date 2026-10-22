export interface ApiConfig {
  port: number;
  host: string;
  version: string;
  databaseUrl: string;
  redisUrl: string;
  dataRoot: string;
  /** A-04: origins allowed to make mutating requests (CSRF check). */
  allowedOrigins: string[];
  /** TS-30: daily OTP SMS budget for the service; when reached, only OAuth login is available. */
  smsDailyBudget: number;
  /** A-01: VK ID OAuth client id (default for dev emulator). */
  vkClientId: string;
  /** A-01: Яндекс ID OAuth client id (default for dev emulator). */
  yandexClientId: string;
  /** Base URL for OAuth provider endpoints; defaults to self for dev emulator. */
  oauthBaseUrl: string;
  /** Frontend URL for post-login redirect. */
  webUrl: string;
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
  const smsDailyBudget = env.SMS_DAILY_BUDGET ? Number(env.SMS_DAILY_BUDGET) : 1000;
  if (!Number.isInteger(smsDailyBudget) || smsDailyBudget < 0) {
    throw new Error(`Неверный суточный бюджет СМС: «${env.SMS_DAILY_BUDGET}»`);
  }
  const apiPort = env.API_PORT ?? env.PORT ?? '3100';
  const selfBaseUrl = `http://${env.API_HOST ?? '127.0.0.1'}:${apiPort}`;
  return {
    port: parsed,
    host: env.API_HOST ?? '127.0.0.1',
    version: env.APP_VERSION ?? 'dev',
    databaseUrl,
    redisUrl,
    dataRoot: env.DATA_ROOT ?? '/',
    allowedOrigins: rawOrigins.split(',').map((s) => s.trim()).filter(Boolean),
    smsDailyBudget,
    vkClientId: env.VK_CLIENT_ID ?? 'dev-vk',
    yandexClientId: env.YANDEX_CLIENT_ID ?? 'dev-yandex',
    oauthBaseUrl: env.OAUTH_BASE_URL ?? `${selfBaseUrl}/api/v1`,
    webUrl: env.WEB_URL ?? 'http://localhost:3110',
  };
}
