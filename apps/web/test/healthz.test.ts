import { describe, expect, it } from 'vitest';
import { GET } from '../app/healthz/route.js';

describe('GET /healthz', () => {
  it('отвечает status=ok и не кэшируется', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'blokum-web' });
  });
});
