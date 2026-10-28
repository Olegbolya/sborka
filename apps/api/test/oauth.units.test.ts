import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OAuthService, type OAuthProvider } from '../src/auth/oauth.service.js';
import { InMemoryOAuthStateStore } from '../src/auth/oauth-state.js';
import vm from 'node:vm';
import { DevOAuthController } from '../src/auth/dev-oauth.controller.js';
import type { SessionService } from '../src/auth/session.service.js';
import type { AdminMfaService } from '../src/auth/admin-mfa.service.js';
import type { AuditLogService } from '../src/auth/audit-log.service.js';
import type { Db } from '@blokum/db';
import { schema } from '@blokum/db';
import { loadApiConfig, type ApiConfig } from '../src/config.js';
import type { Request, Response } from 'express';

// Suppress unused import warning — OAuthProvider is used in type positions.
void (null as unknown as OAuthProvider);

const baseConfig: ApiConfig = {
  port: 3100, host: '127.0.0.1', version: 'test', databaseUrl: '', redisUrl: '',
  dataRoot: '/', allowedOrigins: [], smsDailyBudget: 1000,
  vkClientId: 'dev-vk', yandexClientId: 'dev-yandex',
  oauthBaseUrl: 'http://127.0.0.1:3100/api/v1',
  webUrl: 'http://localhost:3110',
  phoneLogin: false,
  adminPhone: '',
  totpSecretKey: 'a'.repeat(64),
  mediaDir: '/tmp',
  mediaBaseUrl: 'http://127.0.0.1:3100/api/v1/media',
};

interface MockDb {
  db: Db;
  selectChain: { from: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn>; innerJoin: ReturnType<typeof vi.fn> };
  insertChain: { values: ReturnType<typeof vi.fn> };
  deleteMock: { where: ReturnType<typeof vi.fn> };
}

function makeDb(): MockDb {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    innerJoin: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);

  const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
  const deleteMock = { where: vi.fn().mockResolvedValue(undefined) };

  const db = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    delete: vi.fn().mockReturnValue(deleteMock),
  } as unknown as Db;

  return { db, selectChain, insertChain, deleteMock };
}

/** Second factor and audit are covered by admin-login.test.ts; here nobody is an administrator. */
const makeMfa = (): AdminMfaService => ({ required: () => false, begin: () => 'pending' }) as unknown as AdminMfaService;
const makeAudit = (): AuditLogService => ({ log: vi.fn().mockResolvedValue(undefined) }) as unknown as AuditLogService;

function makeSessions(): SessionService {
  return { create: vi.fn().mockResolvedValue('tok-abc') } as unknown as SessionService;
}

// A-01: InMemoryOAuthStateStore
describe('A-01: InMemoryOAuthStateStore', () => {
  it('saves and retrieves state within TTL', async () => {
    const store = new InMemoryOAuthStateStore();
    await store.save('s1', { provider: 'vk', codeVerifier: 'cv', redirectUri: 'http://x' });
    const d = await store.get('s1');
    expect(d).toMatchObject({ provider: 'vk', codeVerifier: 'cv' });
  });

  it('returns null after delete', async () => {
    const store = new InMemoryOAuthStateStore();
    await store.save('s2', { provider: 'yandex', codeVerifier: 'cv2', redirectUri: 'http://x' });
    await store.delete('s2');
    expect(await store.get('s2')).toBeNull();
  });

  it('returns null for unknown state', async () => {
    const store = new InMemoryOAuthStateStore();
    expect(await store.get('no-such-state')).toBeNull();
  });

  it('evicts expired entries on next save', async () => {
    const store = new InMemoryOAuthStateStore();
    const states = (store as unknown as { states: Map<string, { data: unknown; expiresAt: number }> }).states;
    states.set('old', { data: { provider: 'vk', codeVerifier: 'x', redirectUri: 'y' }, expiresAt: Date.now() - 1 });
    await store.save('new', { provider: 'vk', codeVerifier: 'cv', redirectUri: 'http://x' });
    expect(states.has('old')).toBe(false);
  });
});

// A-01: OAuthService.initFlow
describe('A-01: OAuthService.initFlow', () => {
  it('returns vk authorization URL with PKCE and state params', async () => {
    const { db } = makeDb();
    const store = new InMemoryOAuthStateStore();
    const svc = new OAuthService(db, baseConfig, store, makeSessions(), makeMfa(), makeAudit());
    const url = await svc.initFlow('vk');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('dev-vk');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('returns yandex authorization URL with correct scope', async () => {
    const { db } = makeDb();
    const store = new InMemoryOAuthStateStore();
    const svc = new OAuthService(db, baseConfig, store, makeSessions(), makeMfa(), makeAudit());
    const url = await svc.initFlow('yandex');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('dev-yandex');
    expect(parsed.searchParams.get('scope')).toContain('login:');
  });

  it('stores state in the store', async () => {
    const { db } = makeDb();
    const store = new InMemoryOAuthStateStore();
    const svc = new OAuthService(db, baseConfig, store, makeSessions(), makeMfa(), makeAudit());
    const url = await svc.initFlow('vk');
    const state = new URL(url).searchParams.get('state')!;
    const stored = await store.get(state);
    expect(stored).not.toBeNull();
    expect(stored!.provider).toBe('vk');
    expect(stored!.codeVerifier).toBeTruthy();
  });
});

// A-01: OAuthService.processCallback — validation
describe('A-01: OAuthService.processCallback — state validation', () => {
  it('throws INVALID_OAUTH_STATE when state is missing', async () => {
    const { db } = makeDb();
    const svc = new OAuthService(db, baseConfig, new InMemoryOAuthStateStore(), makeSessions(), makeMfa(), makeAudit());
    await expect(svc.processCallback('vk', 'code', 'no-state', '1.2.3.4', 'ua'))
      .rejects.toThrow(BadRequestException);
  });

  it('throws INVALID_OAUTH_STATE when provider does not match', async () => {
    const store = new InMemoryOAuthStateStore();
    await store.save('s', { provider: 'yandex', codeVerifier: 'cv', redirectUri: 'http://x' });
    const { db } = makeDb();
    const svc = new OAuthService(db, baseConfig, store, makeSessions(), makeMfa(), makeAudit());
    await expect(svc.processCallback('vk', 'code', 's', '1.2.3.4', 'ua'))
      .rejects.toThrow(BadRequestException);
  });

  it('deletes state after consuming it (even on token exchange failure)', async () => {
    const store = new InMemoryOAuthStateStore();
    await store.save('s', { provider: 'vk', codeVerifier: 'cv', redirectUri: 'http://x' });
    const { db } = makeDb();
    const svc = new OAuthService(db, baseConfig, store, makeSessions(), makeMfa(), makeAudit());

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });

    await expect(svc.processCallback('vk', 'code', 's', '1.2.3.4', 'ua')).rejects.toThrow();
    expect(await store.get('s')).toBeNull();
  });
});

// A-01: OAuthService — findOrCreateUser flows
describe('A-01: OAuthService — findOrCreateUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns existing user when identity found', async () => {
    const { db, selectChain } = makeDb();
    const existingUser = { id: 'u1', role: 'USER', status: 'ACTIVE', displayName: 'Иван', phoneE164: null };
    selectChain.limit.mockResolvedValueOnce([{ users: existingUser }]);

    const store = new InMemoryOAuthStateStore();
    await store.save('st', { provider: 'vk', codeVerifier: 'cv', redirectUri: 'http://x/callback' });

    const sessions = makeSessions();
    const svc = new OAuthService(db, baseConfig, store, sessions, makeMfa(), makeAudit());

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ response: [{ id: 42, first_name: 'Иван', last_name: '' }] }) });

    const result = await svc.processCallback('vk', 'code', 'st', '1.2.3.4', 'ua');
    expect(result.user.id).toBe('u1');
    expect(sessions.create).toHaveBeenCalledWith('u1', expect.any(Object));
  });

  it('creates new user when identity not found', async () => {
    const { db, selectChain } = makeDb();
    selectChain.limit.mockResolvedValueOnce([]);

    const store = new InMemoryOAuthStateStore();
    await store.save('st2', { provider: 'yandex', codeVerifier: 'cv', redirectUri: 'http://x/callback' });

    const sessions = makeSessions();
    const svc = new OAuthService(db, baseConfig, store, sessions, makeMfa(), makeAudit());

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: '99', display_name: 'Новый Пользователь', login: 'novyi' }) });

    const result = await svc.processCallback('yandex', 'code', 'st2', '1.2.3.4', 'ua');
    expect(result.user.displayName).toBe('Новый Пользователь');
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith(schema.users);
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith(schema.authIdentities);
  });
});

// A-01: linkIdentity / unlinkIdentity
describe('A-01: linkIdentity and unlinkIdentity', () => {
  it('linkIdentity does nothing if identity already exists', async () => {
    const { db, selectChain } = makeDb();
    selectChain.limit.mockResolvedValueOnce([{ id: 'id1', userId: 'u1', provider: 'VK', providerUserId: '42' }]);
    const svc = new OAuthService(db, baseConfig, new InMemoryOAuthStateStore(), makeSessions(), makeMfa(), makeAudit());
    await svc.linkIdentity('u1', 'vk', '42');
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
  });

  it('linkIdentity inserts when no identity exists', async () => {
    const { db, selectChain } = makeDb();
    selectChain.limit.mockResolvedValueOnce([]);
    const svc = new OAuthService(db, baseConfig, new InMemoryOAuthStateStore(), makeSessions(), makeMfa(), makeAudit());
    await svc.linkIdentity('u1', 'vk', '99');
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith(schema.authIdentities);
  });

  it('05-LEGAL §2.5: unlinkIdentity rejects when only one identity remains', async () => {
    const { db } = makeDb();
    const selectMock = { from: vi.fn(), where: vi.fn() };
    selectMock.from.mockReturnValue(selectMock);
    selectMock.where.mockResolvedValue([{ id: 'id1', userId: 'u1', provider: 'VK', providerUserId: '42' }]);
    (db as unknown as { select: ReturnType<typeof vi.fn> }).select = vi.fn().mockReturnValue(selectMock);
    const svc = new OAuthService(db, baseConfig, new InMemoryOAuthStateStore(), makeSessions(), makeMfa(), makeAudit());
    await expect(svc.unlinkIdentity('u1', 'vk')).rejects.toThrow(BadRequestException);
  });

  it('05-LEGAL §2.5: unlinkIdentity succeeds when multiple identities remain', async () => {
    const { db, deleteMock } = makeDb();
    const selectMock = { from: vi.fn(), where: vi.fn() };
    selectMock.from.mockReturnValue(selectMock);
    selectMock.where.mockResolvedValue([
      { id: 'id1', userId: 'u1', provider: 'VK', providerUserId: '42' },
      { id: 'id2', userId: 'u1', provider: 'YANDEX', providerUserId: '77' },
    ]);
    (db as unknown as { select: ReturnType<typeof vi.fn> }).select = vi.fn().mockReturnValue(selectMock);
    (db as unknown as { delete: ReturnType<typeof vi.fn> }).delete = vi.fn().mockReturnValue(deleteMock);
    const svc = new OAuthService(db, baseConfig, new InMemoryOAuthStateStore(), makeSessions(), makeMfa(), makeAudit());
    await expect(svc.unlinkIdentity('u1', 'vk')).resolves.not.toThrow();
    expect((db as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith(schema.authIdentities);
  });
});

// A-01: DevOAuthController
describe('A-01: DevOAuthController', () => {
  it('throws in production', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new DevOAuthController()).toThrow('запрещён в рабочей среде');
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('authorize returns HTML with form action pointing to redirect_uri', () => {
    const ctrl = new DevOAuthController();
    const html = ctrl.authorize('vk', 'dev-vk', 'http://host/callback', 'state123', 'challenge');
    expect(html).toContain('http://host/callback');
    expect(html).toContain('state123');
    expect(html).toContain('<form');
  });

  it('форма эмулятора: скрипт — исправный JavaScript и кладёт пользователя в code', () => {
    const html = new DevOAuthController().authorize('vk', 'dev-vk', 'http://host/callback', 'st', 'ch');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(script).not.toBe('');
    let submit: ((e: { currentTarget: unknown }) => void) | undefined;
    const form = { user_id: { value: '77' }, display_name: { value: 'Иван Петров' }, code: { value: 'dev-code-vk' }, addEventListener: (_: string, fn: typeof submit) => { submit = fn; } };
    vm.runInNewContext(script, {
      document: { currentScript: { closest: () => form } },
      btoa: (b: string) => Buffer.from(b, 'latin1').toString('base64'),
      TextEncoder,
      String,
    });
    submit?.({ currentTarget: form });
    const [prefix, encoded] = form.code.value.split('.');
    expect(prefix).toBe('dev-code-vk');
    expect(JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString())).toEqual({ userId: '77', displayName: 'Иван Петров' });
  });

  it('token returns access_token for dev-code- prefix', () => {
    const ctrl = new DevOAuthController();
    const jsonFn = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: jsonFn } as unknown as Response;
    ctrl.token('vk', 'dev-code-vk', {} as unknown as Request, res);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ access_token: expect.any(String) }));
  });

  it('token rejects invalid code', () => {
    const ctrl = new DevOAuthController();
    const statusFn = vi.fn().mockReturnThis();
    const res = { status: statusFn, json: vi.fn() } as unknown as Response;
    ctrl.token('vk', 'bad-code', {} as unknown as Request, res);
    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('me returns vk profile structure', () => {
    const ctrl = new DevOAuthController();
    const token = Buffer.from(JSON.stringify({ userId: '5', displayName: 'Пётр Иванов' })).toString('base64url');
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = { json: vi.fn() } as unknown as Response;
    ctrl.me('vk', req, res);
    expect((res as unknown as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(
      expect.objectContaining({ response: expect.arrayContaining([expect.objectContaining({ id: 5 })]) }),
    );
  });

  it('me returns yandex profile structure', () => {
    const ctrl = new DevOAuthController();
    const token = Buffer.from(JSON.stringify({ userId: '99', displayName: 'Яша Пупкин' })).toString('base64url');
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = { json: vi.fn() } as unknown as Response;
    ctrl.me('yandex', req, res);
    expect((res as unknown as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(
      expect.objectContaining({ id: '99', display_name: 'Яша Пупкин' }),
    );
  });
});

describe('A-01 (ADR-033): вход по телефону выключен по умолчанию', () => {
  it('A-01: без PHONE_LOGIN=1 вход по телефону выключен; в рабочей среде обязателен ключ TOTP', () => {
    expect(loadApiConfig({ NODE_ENV: 'test' }).phoneLogin).toBe(false);
    expect(loadApiConfig({ NODE_ENV: 'test', PHONE_LOGIN: '1' }).phoneLogin).toBe(true);
    expect(() => loadApiConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x' })).toThrow('TOTP_SECRET_KEY');
    expect(() => loadApiConfig({ NODE_ENV: 'test', TOTP_SECRET_KEY: 'короткий' })).toThrow('64');
  });
});

// A-01: OAuthController.callback — ошибки провайдера не показываются JSON-страницей
describe('A-01: OAuthController.callback', () => {
  const makeRes = () => ({ redirect: vi.fn(), setHeader: vi.fn() });
  const call = async (oauth: Partial<OAuthService>, req: Partial<Request>, res = makeRes()) => {
    const { OAuthController } = await import('../src/auth/oauth.controller.js');
    const ctrl = new OAuthController(oauth as OAuthService, makeMfa(), baseConfig);
    await ctrl.callback('vk', 'c', 's', { headers: {}, socket: {}, ...req } as Request, res as unknown as Response);
    return res;
  };

  it('успех: сеанс в cookie, переход на онбординг; адрес берётся из первого элемента X-Forwarded-For', async () => {
    const processCallback = vi.fn().mockResolvedValue({ token: 'tok', user: {} });
    const res = await call({ processCallback }, { headers: { 'x-forwarded-for': ['1.1.1.1, 2.2.2.2'], 'user-agent': 'UA' } });
    expect(processCallback).toHaveBeenCalledWith('vk', 'c', 's', '1.1.1.1', 'UA');
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('session=tok'));
    expect(res.redirect).toHaveBeenCalledWith(302, 'http://localhost:3110/onboarding');
  });

  it('успех без заголовков: адрес берётся из сокета', async () => {
    const processCallback = vi.fn().mockResolvedValue({ token: 'tok', user: {} });
    await call({ processCallback }, { socket: { remoteAddress: '9.9.9.9' } as Request['socket'] });
    expect(processCallback).toHaveBeenCalledWith('vk', 'c', 's', '9.9.9.9', '');
  });

  it('отказ провайдера (BadRequest) → страница входа, cookie нет', async () => {
    const processCallback = vi.fn().mockRejectedValue(new BadRequestException('x'));
    const res = await call({ processCallback }, {});
    expect(res.redirect).toHaveBeenCalledWith(302, 'http://localhost:3110/login?error=oauth');
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('неожиданная ошибка не скрывается за страницей входа', async () => {
    const processCallback = vi.fn().mockRejectedValue(new Error('сбой базы'));
    await expect(call({ processCallback }, {})).rejects.toThrow('сбой базы');
  });
});

describe('A-01: эмулятор — запасные ветви', () => {
  it('форма для Яндекс ID называется «Яндекс ID»', () => {
    expect(new DevOAuthController().authorize('yandex', 'dev-yandex', 'http://h/cb', 's', 'c')).toContain('Яндекс ID');
  });

  it('me: без токена или с мусором отвечает профилем по умолчанию', () => {
    const ctrl = new DevOAuthController();
    const res = { json: vi.fn() } as unknown as Response;
    ctrl.me('vk', { headers: { authorization: 'Bearer ***' } } as unknown as Request, res);
    ctrl.me('yandex', { headers: {} } as unknown as Request, res);
    const calls = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls;
    expect(calls[0]?.[0]).toEqual({ response: [{ id: 42, first_name: 'Тест', last_name: 'Тестов' }] });
    expect(calls[1]?.[0]).toMatchObject({ id: '42', display_name: 'Тест Тестов' });
  });

  it('token: код из тела запроса (так его присылает сервис входа)', () => {
    const ctrl = new DevOAuthController();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    ctrl.token('vk', undefined as unknown as string, { body: { code: 'dev-code-vk' } } as unknown as Request, res);
    expect((res as unknown as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(expect.objectContaining({ access_token: expect.any(String) }));
  });
});
