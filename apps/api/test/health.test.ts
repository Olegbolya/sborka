import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, createApp } from '../src/app.js';
import { loadApiConfig } from '../src/config.js';

describe('GET /api/v1/health', () => {
  let app: INestApplication;
  const http = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    app = await createApp({ port: 0, host: '127.0.0.1', version: 'test-1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('отвечает status=ok с версией и временем', async () => {
    const res = await request(http()).get(`/${API_PREFIX}/health`).expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'blokum-api', version: 'test-1' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.time as string))).toBe(false);
  });

  it('без префикса /api/v1 эндпоинта нет', async () => {
    await request(http()).get('/health').expect(404);
  });
});

describe('настройки API', () => {
  it('порт по умолчанию — 3100, хост — 127.0.0.1', () => {
    expect(loadApiConfig({})).toEqual({ port: 3100, host: '127.0.0.1', version: 'dev' });
  });

  it('берёт порт и версию из окружения', () => {
    expect(loadApiConfig({ API_PORT: '4000', APP_VERSION: 'abc123' })).toMatchObject({ port: 4000, version: 'abc123' });
  });

  it.each(['0', '70000', 'abc', '3.5'])('отклоняет порт «%s»', (port) => {
    expect(() => loadApiConfig({ API_PORT: port })).toThrow('Неверный порт API');
  });
});
