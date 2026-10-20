import { Writable } from 'node:stream';
import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import { type Alert, Alerts, createLogger } from '@blokum/observability';
import { type AppDeps } from '../src/app.module.js';
import { createApp } from '../src/app.js';
import { type ApiConfig } from '../src/config.js';
import { type HealthProbes } from '../src/health/health.controller.js';

export const testConfig: ApiConfig = {
  port: 0,
  host: '127.0.0.1',
  version: 'test-1',
  databaseUrl: 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_test',
  redisUrl: 'redis://127.0.0.1:6379/3',
  dataRoot: '/',
};

export const okProbes: HealthProbes = {
  database: () => Promise.resolve(true),
  redis: () => Promise.resolve(true),
  diskUsedPct: () => Promise.resolve(42),
};

export interface TestApp {
  app: INestApplication;
  http(): Server;
  logs: Array<Record<string, unknown>>;
  alerts: Alert[];
}

export async function startTestApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
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
  const app = await createApp(testConfig, { logger, alerts, probes: okProbes, ...overrides });
  await app.init();
  return { app, http: () => app.getHttpServer() as Server, logs, alerts: sent };
}
