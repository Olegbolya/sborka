import { BadRequestException, Controller, Get, HttpException } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/app.js';
import { startTestApp, type TestApp } from './helpers.js';

@Controller('test-errors')
class ErrorsController {
  @Get('boom')
  boom(): never {
    throw new Error('Сломалось для +79991234567');
  }

  @Get('bad')
  bad(): never {
    throw new BadRequestException();
  }

  @Get('custom')
  custom(): never {
    throw new HttpException({ error: { code: 'SLUG_TAKEN', message: 'Этот адрес уже занят' } }, 409);
  }

  @Get('slow')
  async slow(): Promise<{ ok: true }> {
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true };
  }
}

describe('id запроса, журнал и ошибки API', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp({ extraControllers: [ErrorsController] });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('id запроса от сайта сохраняется и возвращается в ответе', async () => {
    const res = await request(t.http()).get(`/${API_PREFIX}/test-errors/slow`).set('x-request-id', 'web-req-0001').expect(200);
    expect(res.headers['x-request-id']).toBe('web-req-0001');
    const access = t.logs.find((l) => l.requestId === 'web-req-0001' && l.msg === 'запрос');
    expect(access).toMatchObject({ method: 'GET', status: 200, path: `/${API_PREFIX}/test-errors/slow` });
  });

  it('опасный или отсутствующий id заменяется новым UUID', async () => {
    const res = await request(t.http()).get(`/${API_PREFIX}/health`).set('x-request-id', 'bad id <script>').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const res2 = await request(t.http()).get(`/${API_PREFIX}/health`).expect(200);
    expect(res2.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res2.headers['x-request-id']).not.toBe(res.headers['x-request-id']);
  });

  it('404 — единый формат ошибки на русском', async () => {
    const res = await request(t.http()).get(`/${API_PREFIX}/nothing-here`).expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
  });

  it('400 и собственная ошибка с кодом передаются клиенту как есть', async () => {
    expect((await request(t.http()).get(`/${API_PREFIX}/test-errors/bad`).expect(400)).body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Неверный запрос' },
    });
    expect((await request(t.http()).get(`/${API_PREFIX}/test-errors/custom`).expect(409)).body).toEqual({
      error: { code: 'SLUG_TAKEN', message: 'Этот адрес уже занят' },
    });
  });

  it('500: клиент видит код запроса без подробностей, в журнале — замаскированная ошибка', async () => {
    const res = await request(t.http()).get(`/${API_PREFIX}/test-errors/boom`).set('x-request-id', 'boom-req-01').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера. Код запроса: boom-req-01' } });
    const logged = t.logs.find((l) => l.requestId === 'boom-req-01' && l.msg === 'необработанная ошибка');
    expect(logged).toBeDefined();
    expect(JSON.stringify(logged)).not.toContain('9991234');
  });

  it('20 ошибок 5xx за минуту — одна тревога администратору', async () => {
    for (let i = 0; i < 25; i++) await request(t.http()).get(`/${API_PREFIX}/test-errors/boom`).expect(500);
    expect(t.alerts.filter((a) => a.key === 'http_5xx')).toHaveLength(1);
    expect(t.alerts[0]).toMatchObject({ severity: 'critical', title: 'Всплеск ошибок сервера (5xx) в API' });
  });
});
