import { createServer, type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config, proxy } from '../proxy.js';

describe('id запроса на сайте', () => {
  it('сохраняет безопасный входящий id и возвращает его браузеру', () => {
    const res = proxy(new NextRequest('http://127.0.0.1:3110/', { headers: { 'x-request-id': 'browser-req-1' } }));
    expect(res.headers.get('x-request-id')).toBe('browser-req-1');
    expect(res.headers.get('x-middleware-request-x-request-id')).toBe('browser-req-1');
  });

  it('создаёт новый id, если входящего нет или он небезопасен', () => {
    const fresh = proxy(new NextRequest('http://127.0.0.1:3110/s/abc'));
    expect(fresh.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const unsafe = proxy(new NextRequest('http://127.0.0.1:3110/', { headers: { 'x-request-id': 'bad id <x>' } }));
    expect(unsafe.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('не обрабатывает статику Next.js', () => {
    expect(config.matcher[0]).toContain('_next/static');
  });
});

describe('apiFetch передаёт id запроса в API', () => {
  let seen: IncomingHttpHeaders | undefined;
  let url = '';
  const server = createServer((req, res) => {
    seen = req.headers;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url }));
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.API_INTERNAL_URL = url;
  });
  afterAll(() => {
    server.close();
  });

  it('добавляет заголовок x-request-id и accept', async () => {
    const { apiFetch } = await import('../lib/api-client.js');
    const res = await apiFetch('api/v1/health', { requestId: 'page-req-777' });
    expect(await res.json()).toEqual({ path: '/api/v1/health' });
    expect(seen?.['x-request-id']).toBe('page-req-777');
    expect(seen?.accept).toBe('application/json');
  });
});
