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
  /**
   * A-01: login by phone code. Off unless PHONE_LOGIN=1 — the owner declined SMS for cost (ADR-033); the code is
   * kept for a cheaper provider later. In production it also needs a real `OtpSender`, which is not connected.
   */
  phoneLogin: boolean;
  /** AD-01: phone that is automatically promoted to ADMIN role on first login. */
  adminPhone: string;
  /** AD-01 · accounts promoted to ADMIN at sign-in through a provider: `vk:<id>`, `yandex:<id>` (ADR-033). */
  adminAccounts?: string[];
  /** AD-01: AES-256-GCM key (64 hex chars = 32 bytes) for encrypting TOTP secrets. */
  totpSecretKey: string;
  /** TS-13 · limits of frequency on the public side, by the hash of the address. */
  playLimits?: { startsPerHourPerIp: number; answersPerMinutePerSession: number; reportsPerHourPerIp?: number };
  /** P4.3: directory where uploaded media files are stored (under DATA_ROOT). */
  /** AD-09: where the backups are put (P9.5); the admin shows the newest one. */
  backupDir?: string;
  mediaDir: string;
  /** P4.3: base URL for serving media files (media.blokum.ru in production, /api/v1/media in dev). */
  mediaBaseUrl: string;
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
  if (production && !env.TOTP_SECRET_KEY) throw new Error('Не задан TOTP_SECRET_KEY (в рабочей среде он обязателен)');
  if (env.TOTP_SECRET_KEY && !/^[0-9a-f]{64}$/i.test(env.TOTP_SECRET_KEY)) throw new Error('TOTP_SECRET_KEY — 64 шестнадцатеричных символа');
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
    phoneLogin: env.PHONE_LOGIN === '1',
    adminPhone: env.ADMIN_PHONE ?? '',
    adminAccounts: (env.ADMIN_ACCOUNTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    totpSecretKey: env.TOTP_SECRET_KEY ?? 'a'.repeat(64),
    playLimits: { startsPerHourPerIp: Number(env.PLAY_STARTS_PER_HOUR_PER_IP ?? 120), answersPerMinutePerSession: Number(env.PLAY_ANSWERS_PER_MINUTE ?? 240), reportsPerHourPerIp: Number(env.REPORTS_PER_HOUR_PER_IP ?? 5) },
    ...(env.BACKUP_DIR ? { backupDir: env.BACKUP_DIR } : {}),
    mediaDir: env.MEDIA_DIR ?? (production ? '/srv/blokum/media' : `${env.DATA_ROOT ?? '/tmp'}/blokum-media`),
    mediaBaseUrl: env.MEDIA_BASE_URL ?? `http://${env.API_HOST ?? '127.0.0.1'}:${parsed}/api/v1/media`,
  };
}
