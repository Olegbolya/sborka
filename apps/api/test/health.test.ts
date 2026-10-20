import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/app.js';
import { loadApiConfig } from '../src/config.js';
import { okProbes, startTestApp, type TestApp } from './helpers.js';

describe('GET /api/v1/health', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('отвечает status=ok с версией, временем и состоянием зависимостей', async () => {
    const res = await request(t.http()).get(`/${API_PREFIX}/health`).expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'blokum-api',
      version: 'test-1',
      checks: { database: 'ok', redis: 'ok', diskUsedPct: 42 },
    });
    expect(Number.isNaN(Date.parse(res.body.time as string))).toBe(false);
  });

  it('без префикса /api/v1 эндпоинта нет', async () => {
    await request(t.http()).get('/health').expect(404);
  });
});

describe('здоровье при проблемах зависимостей', () => {
  it.each([
    ['база недоступна', { ...okProbes, database: () => Promise.resolve(false) }, { database: 'fail' }],
    ['Redis упал с исключением', { ...okProbes, redis: () => Promise.reject(new Error('нет')) }, { redis: 'fail' }],
    ['диск заполнен на 95 %', { ...okProbes, diskUsedPct: () => Promise.resolve(95) }, { diskUsedPct: 95 }],
    ['диск не читается', { ...okProbes, diskUsedPct: () => Promise.reject(new Error('нет')) }, null],
  ])('%s → degraded или ok, но всегда HTTP 200', async (_name, probes, checks) => {
    const t = await startTestApp({ probes });
    const res = await request(t.http()).get(`/${API_PREFIX}/health`).expect(200);
    if (checks) {
      expect(res.body.status).toBe('degraded');
      expect(res.body.checks).toMatchObject(checks);
    } else {
      expect(res.body).toMatchObject({ status: 'ok', checks: { diskUsedPct: null } });
    }
    await t.app.close();
  });
});

describe('настройки API', () => {
  it('в разработке — порт 3100, 127.0.0.1 и локальные БД/Redis по умолчанию', () => {
    expect(loadApiConfig({})).toMatchObject({
      port: 3100,
      host: '127.0.0.1',
      version: 'dev',
      databaseUrl: 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_dev',
      redisUrl: 'redis://127.0.0.1:6379/3',
    });
  });

  it('в рабочей среде адреса БД и Redis обязательны', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL');
    expect(() => loadApiConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u@127.0.0.1/db' })).toThrow('REDIS_URL');
  });

  it('берёт порт, версию и каталог данных из окружения', () => {
    expect(loadApiConfig({ API_PORT: '4000', APP_VERSION: 'abc123', DATA_ROOT: '/srv/blokum' })).toMatchObject({
      port: 4000,
      version: 'abc123',
      dataRoot: '/srv/blokum',
    });
  });

  it.each(['0', '70000', 'abc', '3.5'])('отклоняет порт «%s»', (port) => {
    expect(() => loadApiConfig({ API_PORT: port })).toThrow('Неверный порт API');
  });
});
