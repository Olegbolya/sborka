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

// A-01 (ADR-033): phone login is off — the owner declined SMS. It can be switched on only outside production, with
// the development sender; production has no SMS provider and refuses to start rather than fake one.
if (config.phoneLogin && production) {
  throw new Error('Вход по телефону включён (PHONE_LOGIN=1), но СМС-провайдер не подключён');
}
const otpSender: OtpSender | undefined = config.phoneLogin ? new DevOtpSender() : undefined;
const captchaVerifier: CaptchaVerifier | undefined = config.phoneLogin ? new DevCaptchaVerifier() : undefined;

const app = await createApp(config, {
  logger,
  alerts,
  db: db.db,
  ...(otpSender ? { otpSender } : {}),
  ...(captchaVerifier ? { captchaVerifier } : {}),
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
