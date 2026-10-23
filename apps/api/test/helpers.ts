import { Writable } from 'node:stream';
import { type Server } from 'node:http';
import os from 'node:os';
import { type INestApplication } from '@nestjs/common';
import { type Alert, Alerts, createLogger } from '@blokum/observability';
import { createDb, runMigrations, type Db } from '@blokum/db';
import pg from 'pg';
import { createId } from '@blokum/schema';
import { type AppDeps } from '../src/app.module.js';
import { API_PREFIX, createApp } from '../src/app.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import { type ApiConfig } from '../src/config.js';
import { type HealthProbes } from '../src/health/health.controller.js';
import type { IMediaQueue } from '../src/media/media-jobs.js';

export const TEST_BASE_URL = process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test';

export const testConfig: ApiConfig = {
  port: 0,
  host: '127.0.0.1',
  version: 'test-1',
  databaseUrl: 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test',
  redisUrl: 'redis://127.0.0.1:6379/3',
  dataRoot: '/',
  allowedOrigins: ['http://localhost:3110'],
  smsDailyBudget: 1000,
  vkClientId: 'dev-vk',
  yandexClientId: 'dev-yandex',
  oauthBaseUrl: 'http://127.0.0.1:0/api/v1',
  webUrl: 'http://localhost:3110',
  phoneLogin: true,
  adminPhone: '+79990000001',
  totpSecretKey: 'a'.repeat(64),
  mediaDir: os.tmpdir(),
  mediaBaseUrl: 'http://127.0.0.1:0/api/v1/media',
};

export const okProbes: HealthProbes = {
  database: () => Promise.resolve(true),
  redis: () => Promise.resolve(true),
  diskUsedPct: () => Promise.resolve(42),
};

export interface TestDb {
  db: Db;
  url: string;
  drop(): Promise<void>;
}

/** Creates an isolated migrated database for tests. */
export async function createTestDb(): Promise<TestDb> {
  const name = `blokum_t_${createId(12)}`;
  const admin = new pg.Client({ connectionString: TEST_BASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const url = new URL(TEST_BASE_URL);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString(), { max: 4, applicationName: 'blokum-test' });
  await runMigrations(handle.db);
  return {
    db: handle.db,
    url: url.toString(),
    async drop() {
      await handle.close();
      const c = new pg.Client({ connectionString: TEST_BASE_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}

export interface TestApp {
  app: INestApplication;
  http(): Server;
  logs: Array<Record<string, unknown>>;
  alerts: Alert[];
}

/** No-op queue: prevents real BullMQ/Redis connections in tests that don't test media. */
const noopMediaQueue: IMediaQueue = { add: () => Promise.resolve() };

export async function startTestApp(overrides: Partial<AppDeps> = {}, configOverrides: Partial<typeof testConfig> = {}): Promise<TestApp> {
  const logs: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _e, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) logs.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  const sent: Alert[] = [];
  const logger = createLogger({ service: 'blokum-api', version: 'test-1', level: 'debug' }, stream);
  const alerts = new Alerts({ channels: [{ name: 'test', send: (a) => (sent.push(a), Promise.resolve()) }] });
  const stubDb = {} as Db;
  const stubOtpSender: OtpSender = { sendCode: () => Promise.resolve() };
  const stubCaptcha: CaptchaVerifier = { verify: () => Promise.resolve(true) };
  // Use a mutable config copy so we can patch oauthBaseUrl after the server binds to a port.
  const dynamicConfig = { ...testConfig, ...configOverrides };
  const app = await createApp(dynamicConfig, { logger, alerts, probes: okProbes, db: stubDb, otpSender: stubOtpSender, captchaVerifier: stubCaptcha, mediaQueue: noopMediaQueue, ...overrides });
  await app.init();
  // Bind to an OS-assigned port so that OAuthService can call back to the dev emulator via HTTP.
  await app.listen(0);
  const addr = (app.getHttpServer() as Server).address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  dynamicConfig.oauthBaseUrl = `http://127.0.0.1:${port}/${API_PREFIX}`;
  return { app, http: () => app.getHttpServer() as Server, logs, alerts: sent };
}
