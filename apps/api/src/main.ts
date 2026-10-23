import { checkDatabase, createDb } from '@blokum/db';
import { createAlertsFromEnv, createLogger, diskUsagePercent } from '@blokum/observability';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { DevCaptchaVerifier } from './auth/captcha.js';
import { DevOtpSender } from './auth/otp-sender.js';
import type { CaptchaVerifier } from './auth/captcha.js';
import type { OtpSender } from './auth/otp-sender.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig();
const logger = createLogger({ service: 'blokum-api', version: config.version });
const alerts = createAlertsFromEnv(process.env, { logger });
const db = createDb(config.databaseUrl, { applicationName: 'blokum-api' });
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
redis.on('error', (e) => logger.warn({ err: e }, 'Redis недоступен'));
await redis.connect().catch((e: unknown) => logger.error({ err: e }, 'Не удалось подключиться к Redis'));

const production = process.env.NODE_ENV === 'production';

// Until a real Russian SMS/captcha provider is configured, log codes to server log.
// The owner can see OTP codes via `pm2 logs blokum-api`.
const otpSender: OtpSender = production
  ? { sendCode: (phone, code) => { logger.warn({ phone, code }, 'OTP-код (SMS-провайдер не настроен — код в логе сервера)'); return Promise.resolve(); } }
  : new DevOtpSender();
const captchaVerifier: CaptchaVerifier = production
  ? { verify: () => { logger.warn({}, 'Captcha пропущена (провайдер не настроен)'); return Promise.resolve(true); } }
  : new DevCaptchaVerifier();

const app = await createApp(config, {
  logger,
  alerts,
  db: db.db,
  otpSender,
  captchaVerifier,
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
