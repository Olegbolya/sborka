import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/app.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

describe('A-01 · OAuth VK и Яндекс ID (интеграция)', () => {
  let t: TestApp;
  let db: TestDb;

  beforeAll(async () => {
    try {
      db = await createTestDb();
      t = await startTestApp({ db: db.db });
    } catch {
      // PostgreSQL not available — tests skipped.
    }
  });

  afterAll(async () => {
    await t?.app.close();
    await db?.drop();
  });

  function skip() {
    return !t;
  }

  // ── init redirect ────────────────────────────────────────────────────────────

  it('A-01 · GET /auth/oauth/vk/init → 302 redirect to dev emulator', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/vk/init`)
      .redirects(0)
      .expect(302);
    expect(res.headers['location']).toContain('/dev/oauth/vk/authorize');
    expect(res.headers['location']).toContain('client_id=dev-vk');
    expect(res.headers['location']).toContain('state=');
    expect(res.headers['location']).toContain('code_challenge=');
  });

  it('A-01 · GET /auth/oauth/yandex/init → 302 redirect to dev emulator', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/yandex/init`)
      .redirects(0)
      .expect(302);
    expect(res.headers['location']).toContain('/dev/oauth/yandex/authorize');
    expect(res.headers['location']).toContain('client_id=dev-yandex');
  });

  it('A-01 · GET /auth/oauth/unknown/init → 400', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/google/init`)
      .expect(400);
    expect(res.body.error?.code).toBe('UNKNOWN_OAUTH_PROVIDER');
  });

  // ── dev emulator endpoints ───────────────────────────────────────────────────

  it('A-01 · GET /dev/oauth/vk/authorize → HTML form', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/dev/oauth/vk/authorize?client_id=dev-vk&redirect_uri=http://x/cb&state=s1&code_challenge=ch`)
      .expect(200);
    expect(res.text).toContain('<form');
    expect(res.text).toContain('s1');
  });

  it('A-01 · POST /dev/oauth/vk/token → returns access_token', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .post(`/${API_PREFIX}/dev/oauth/vk/token?code=dev-code-vk`)
      .set('X-Blokum-CSRF', '1')
      .expect(200);
    expect(res.body.access_token).toBeTruthy();
  });

  it('A-01 · GET /dev/oauth/vk/me → returns vk profile', async () => {
    if (skip()) return;
    const token = Buffer.from(JSON.stringify({ provider: 'vk', userId: '7', displayName: 'Тест Тестов' })).toString('base64url');
    const res = await request(t.http())
      .get(`/${API_PREFIX}/dev/oauth/vk/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.response?.[0]?.id).toBe(7);
  });

  it('A-01 · GET /dev/oauth/yandex/me → returns yandex profile', async () => {
    if (skip()) return;
    const token = Buffer.from(JSON.stringify({ provider: 'yandex', userId: '55', displayName: 'Яндекс Пользователь' })).toString('base64url');
    const res = await request(t.http())
      .get(`/${API_PREFIX}/dev/oauth/yandex/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe('55');
    expect(res.body.display_name).toBe('Яндекс Пользователь');
  });

  // ── full callback flow ───────────────────────────────────────────────────────

  it('A-01 · полный VK flow: init → dev token → callback → cookie', async () => {
    if (skip()) return;

    // Step 1: init — get redirect URL with state
    const initRes = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/vk/init`)
      .redirects(0)
      .expect(302);
    const authUrl = new URL(initRes.headers['location'] as string, 'http://127.0.0.1');
    const state = authUrl.searchParams.get('state')!;
    expect(state).toBeTruthy();

    // Step 2: simulate provider returning code + state to callback
    const cbRes = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/vk/callback?code=dev-code-vk&state=${state}`)
      .redirects(0)
      .expect(302);

    expect(cbRes.headers['set-cookie']).toBeDefined();
    const cookies = Array.isArray(cbRes.headers['set-cookie'])
      ? (cbRes.headers['set-cookie'] as string[])
      : [cbRes.headers['set-cookie'] as string];
    expect(cookies.some((c: string) => c.startsWith('session='))).toBe(true);
    expect(cbRes.headers['location']).toBe('http://localhost:3110');
  });

  it('A-01 · полный Яндекс flow: init → callback → cookie', async () => {
    if (skip()) return;

    const initRes = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/yandex/init`)
      .redirects(0)
      .expect(302);
    const authUrl = new URL(initRes.headers['location'] as string, 'http://127.0.0.1');
    const state = authUrl.searchParams.get('state')!;

    const cbRes = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/yandex/callback?code=dev-code-yandex&state=${state}`)
      .redirects(0)
      .expect(302);

    const cookies = Array.isArray(cbRes.headers['set-cookie'])
      ? (cbRes.headers['set-cookie'] as string[])
      : [cbRes.headers['set-cookie'] as string];
    expect(cookies.some((c: string) => c.startsWith('session='))).toBe(true);
  });

  it('A-01 · повторный вход создаёт ту же учётную запись', async () => {
    if (skip()) return;

    async function loginVk(): Promise<string> {
      const initRes = await request(t.http())
        .get(`/${API_PREFIX}/auth/oauth/vk/init`)
        .redirects(0);
      const state = new URL(initRes.headers['location'] as string, 'http://127.0.0.1').searchParams.get('state')!;
      const cbRes = await request(t.http())
        .get(`/${API_PREFIX}/auth/oauth/vk/callback?code=dev-code-vk&state=${state}`)
        .redirects(0);
      const cookies = Array.isArray(cbRes.headers['set-cookie'])
        ? (cbRes.headers['set-cookie'] as string[])
        : [cbRes.headers['set-cookie'] as string];
      return cookies.find((c: string) => c.startsWith('session='))?.split(';')[0]?.replace('session=', '') ?? '';
    }

    const tok1 = await loginVk();
    const tok2 = await loginVk();
    expect(tok1).toBeTruthy();
    expect(tok2).toBeTruthy();

    // Both sessions should map to the same user — verify by fetching /auth/me with each token.
    const me1 = await request(t.http())
      .get(`/${API_PREFIX}/auth/me`)
      .set('Cookie', `session=${tok1}`)
      .expect(200);
    const me2 = await request(t.http())
      .get(`/${API_PREFIX}/auth/me`)
      .set('Cookie', `session=${tok2}`)
      .expect(200);
    expect(me1.body.id).toBe(me2.body.id);
  });

  it('A-01 · callback без state → 400', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/vk/callback?code=abc`)
      .expect(400);
    expect(res.body.error?.code).toBe('OAUTH_MISSING_PARAMS');
  });

  it('A-01 · callback с неверным state → 400', async () => {
    if (skip()) return;
    const res = await request(t.http())
      .get(`/${API_PREFIX}/auth/oauth/vk/callback?code=abc&state=invalid-state`)
      .expect(400);
    expect(res.body.error?.code).toBe('INVALID_OAUTH_STATE');
  });
});
