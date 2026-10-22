import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthGuard } from '../src/auth/auth.guard.js';
import { CsrfGuard } from '../src/auth/csrf.guard.js';
import { RolesGuard } from '../src/auth/roles.guard.js';
import { clearSessionCookieHeader, parseSessionCookie, sessionCookieHeader, type ValidSession } from '../src/auth/session.service.js';
import { testConfig } from './helpers.js';

// ── Cookie parsing helpers ───────────────────────────────────────────────────

describe('A-04 · parseSessionCookie', () => {
  it('извлекает токен из заголовка Cookie', () => {
    expect(parseSessionCookie('session=abc123; other=val')).toBe('abc123');
  });
  it('возвращает null при отсутствии cookie', () => {
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie('other=val')).toBeNull();
    expect(parseSessionCookie('')).toBeNull();
  });
  it('возвращает null при пустом значении', () => {
    expect(parseSessionCookie('session=')).toBeNull();
  });
  it('обрабатывает токен с =', () => {
    expect(parseSessionCookie('session=a=b=c')).toBe('a=b=c');
  });
});

describe('A-04 · sessionCookieHeader', () => {
  it('включает HttpOnly, SameSite=Lax, Path=/', () => {
    const h = sessionCookieHeader('tok', false);
    expect(h).toContain('session=tok');
    expect(h).toContain('HttpOnly');
    expect(h).toContain('SameSite=Lax');
    expect(h).toContain('Path=/');
    expect(h).not.toContain('Secure');
  });
  it('добавляет Secure в production', () => {
    expect(sessionCookieHeader('tok', true)).toContain('Secure');
  });
});

describe('A-04 · clearSessionCookieHeader', () => {
  it('устанавливает Max-Age=0 чтобы удалить cookie', () => {
    expect(clearSessionCookieHeader(false)).toContain('Max-Age=0');
    expect(clearSessionCookieHeader(false)).toContain('session=');
  });
});

// ── CSRF guard ───────────────────────────────────────────────────────────────

function makeCtx(method: string, headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('A-04 · CsrfGuard', () => {
  const guard = new CsrfGuard(testConfig);

  it('GET не требует Origin', () => {
    expect(guard.canActivate(makeCtx('GET'))).toBe(true);
  });
  it('POST с X-Blokum-CSRF: 1 разрешён', () => {
    expect(guard.canActivate(makeCtx('POST', { 'x-blokum-csrf': '1' }))).toBe(true);
  });
  it('POST с разрешённым Origin разрешён', () => {
    expect(guard.canActivate(makeCtx('POST', { origin: 'http://localhost:3110' }))).toBe(true);
  });
  it('POST без Origin и без CSRF-заголовка → ForbiddenException', () => {
    expect(() => guard.canActivate(makeCtx('POST'))).toThrow(ForbiddenException);
  });
  it('DELETE с чужим Origin → ForbiddenException', () => {
    expect(() => guard.canActivate(makeCtx('DELETE', { origin: 'https://evil.example' }))).toThrow(ForbiddenException);
  });
  it('PUT с X-Blokum-CSRF: 1 разрешён', () => {
    expect(guard.canActivate(makeCtx('PUT', { 'x-blokum-csrf': '1' }))).toBe(true);
  });
});

// ── Role guard ───────────────────────────────────────────────────────────────

describe('AD-01 · RolesGuard', () => {
  it('пропускает без декоратора @Roles', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new RolesGuard(reflector);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { role: 'USER' } }) }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
  it('пропускает ADMIN при @Roles("ADMIN")', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN'] as never);
    const guard = new RolesGuard(reflector);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { role: 'ADMIN' } }) }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
  it('блокирует USER при @Roles("ADMIN") → ForbiddenException', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN'] as never);
    const guard = new RolesGuard(reflector);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { role: 'USER' } }) }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
  it('блокирует MODERATOR при @Roles("ADMIN") → ForbiddenException', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN'] as never);
    const guard = new RolesGuard(reflector);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { role: 'MODERATOR' } }) }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ── Auth guard ───────────────────────────────────────────────────────────────

function mockAuthCtx(cookieHeader?: string, isPublic = false): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { headers: { cookie: cookieHeader } };
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => null,
    getClass: () => null,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('A-04 · AuthGuard', () => {
  it('пропускает @Public() эндпоинт без cookie', async () => {
    const sessions = { validate: vi.fn() };
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new AuthGuard(sessions as never, reflector);
    const { ctx } = mockAuthCtx(undefined, true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(sessions.validate).not.toHaveBeenCalled();
  });
  it('выбрасывает 401 без cookie', async () => {
    const sessions = { validate: vi.fn() };
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new AuthGuard(sessions as never, reflector);
    const { ctx } = mockAuthCtx(undefined, false);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
  it('выбрасывает 401 если validate() вернул null', async () => {
    const sessions = { validate: vi.fn().mockResolvedValue(null) };
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new AuthGuard(sessions as never, reflector);
    const { ctx } = mockAuthCtx('session=badtoken', false);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
  it('прикрепляет user и sessionId к запросу', async () => {
    const validSession: ValidSession = { id: 'sess1', user: { id: 'u1', role: 'USER', status: 'ACTIVE', displayName: 'Тест', phoneE164: null } };
    const sessions = { validate: vi.fn().mockResolvedValue(validSession) };
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new AuthGuard(sessions as never, reflector);
    const { ctx, req } = mockAuthCtx('session=goodtoken; x=y', false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req['user']).toEqual(validSession.user);
    expect(req['sessionId']).toBe('sess1');
  });
});

// ── SessionService (unit, mocked Drizzle DB) ─────────────────────────────────

import { SessionService } from '../src/auth/session.service.js';

/** Builds a minimal Drizzle mock that handles insert/update/select chains used by SessionService. */
function makeDbMock(overrides: Record<string, unknown> = {}) {
  const where = vi.fn();
  const limit = vi.fn().mockResolvedValue([]);
  const orderBy = vi.fn().mockResolvedValue([]);
  const innerJoin = vi.fn(() => ({ where: vi.fn(() => ({ limit })) }));
  const set = vi.fn(() => ({ where }));
  const values = vi.fn().mockResolvedValue([]);
  const from = vi.fn(() => ({ innerJoin, where: vi.fn(() => ({ orderBy })) }));
  const db = {
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set })),
    select: vi.fn(() => ({ from })),
    ...overrides,
  };
  return { db, mocks: { values, set, where, limit, orderBy, innerJoin, from } };
}

describe('A-04 · SessionService', () => {
  it('create() сохраняет сессию и возвращает непрозрачный токен', async () => {
    const { db } = makeDbMock();
    const svc = new SessionService(db as never);
    const tok = await svc.create('user1', { ua: 'Chrome/120', ip: '1.2.3.4' });
    expect(typeof tok).toBe('string');
    expect(tok.length).toBeGreaterThan(20);
    expect(db.insert).toHaveBeenCalled();
  });

  it('validate() возвращает null при пустом результате запроса', async () => {
    const { db } = makeDbMock();
    const svc = new SessionService(db as never);
    const result = await svc.validate('some-random-token');
    expect(result).toBeNull();
  });

  it('validate() возвращает сессию и продлевает expiresAt при найденной записи', async () => {
    const mockSession = { id: 's1', userId: 'u1', tokenHash: '', createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 1e9), revokedAt: null, ipHash: null, uaFamily: null };
    const mockUser = { id: 'u1', role: 'USER', status: 'ACTIVE', displayName: 'Тест', phoneE164: null };
    const limit = vi.fn().mockResolvedValue([{ session: mockSession, user: mockUser }]);
    const where = vi.fn(() => ({ limit }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin, where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([]) })) }));
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn(() => ({ where: updateWhere }));
    const db = { insert: vi.fn(), update: vi.fn(() => ({ set })), select: vi.fn(() => ({ from })) };
    const svc = new SessionService(db as never);
    const result = await svc.validate('tok');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('s1');
    expect(result?.user.role).toBe('USER');
    expect(db.update).toHaveBeenCalled();
  });

  it('revoke() вызывает update с revokedAt', async () => {
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn(() => ({ where: updateWhere }));
    const db = { insert: vi.fn(), update: vi.fn(() => ({ set })), select: vi.fn() };
    const svc = new SessionService(db as never);
    await svc.revoke('s1', 'u1');
    expect(db.update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ revokedAt: expect.any(Date) }));
  });

  it('revokeAll() вызывает update для всех сессий пользователя', async () => {
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn(() => ({ where: updateWhere }));
    const db = { insert: vi.fn(), update: vi.fn(() => ({ set })), select: vi.fn() };
    const svc = new SessionService(db as never);
    await svc.revokeAll('u1');
    expect(db.update).toHaveBeenCalled();
  });

  it('revokeAll() с exceptSessionId строит условие с ne()', async () => {
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn(() => ({ where: updateWhere }));
    const db = { insert: vi.fn(), update: vi.fn(() => ({ set })), select: vi.fn() };
    const svc = new SessionService(db as never);
    await svc.revokeAll('u1', 'keep-this');
    expect(db.update).toHaveBeenCalled();
  });

  it('list() возвращает пустой список при отсутствии сессий', async () => {
    const { db } = makeDbMock();
    const svc = new SessionService(db as never);
    const result = await svc.list('u1', 's1');
    expect(result).toEqual([]);
  });

  it('list() помечает isCurrent для текущей сессии', async () => {
    const now = new Date();
    const sess = { id: 'current', createdAt: now, lastSeenAt: now, expiresAt: new Date(Date.now() + 1e9), uaFamily: 'Firefox', revokedAt: null };
    const orderBy = vi.fn().mockResolvedValue([sess]);
    const from = vi.fn(() => ({ where: vi.fn(() => ({ orderBy })), innerJoin: vi.fn() }));
    const db = { insert: vi.fn(), update: vi.fn(), select: vi.fn(() => ({ from })) };
    const svc = new SessionService(db as never);
    const result = await svc.list('u1', 'current');
    expect(result[0]?.isCurrent).toBe(true);
    expect(result[0]?.uaFamily).toBe('Firefox');
  });

  it('create() без ua/ip не падает', async () => {
    const { db } = makeDbMock();
    const svc = new SessionService(db as never);
    const tok = await svc.create('user2');
    expect(typeof tok).toBe('string');
  });

  it.each([
    ['Mozilla/5.0 Firefox/110', 'Firefox'],
    ['Mozilla/5.0 Edg/120', 'Edge'],
    ['Mozilla/5.0 Safari/537 Version/16', 'Safari'],
    ['Mozilla/5.0 OPR/100', 'Opera'],
    ['Mozilla/5.0 Opera/9', 'Opera'],
    ['curl/8.0', null],
    ['Mozilla/5.0 Chrome/120 Edg/120', 'Edge'],
  ])('UA «%s» → семейство %s', async (ua, expected) => {
    let captured: { uaFamily?: string | null } = {};
    const db = { insert: vi.fn(() => ({ values: vi.fn((v: { uaFamily?: string | null }) => { captured = v; return Promise.resolve([]); }) })), update: vi.fn(), select: vi.fn() };
    const svc = new SessionService(db as never);
    await svc.create('u', { ua });
    expect(captured.uaFamily ?? null).toBe(expected);
  });
});

// ── Auth controller (unit, mocked SessionService) ───────────────────────────

describe('A-04 · AuthController', () => {
  const mockUser = { id: 'u1', role: 'USER' as const, status: 'ACTIVE' as const, displayName: 'Тест', phoneE164: null };
  const mockRes = { setHeader: vi.fn() } as unknown as Response;

  it('listSessions возвращает список сессий', async () => {
    const items = [{ id: 's1', createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(), uaFamily: 'Chrome', isCurrent: true }];
    const sessions = { list: vi.fn().mockResolvedValue(items) } as never;
    const ctrl = new AuthController(sessions);
    const result = await ctrl.listSessions(mockUser, 's1');
    expect(result).toEqual({ sessions: items });
    expect(sessions.list).toHaveBeenCalledWith('u1', 's1');
  });

  it('logoutEverywhere отзывает все сессии и сбрасывает cookie', async () => {
    const sessions = { revokeAll: vi.fn().mockResolvedValue(undefined) } as never;
    const ctrl = new AuthController(sessions);
    const result = await ctrl.logoutEverywhere(mockUser, mockRes);
    expect(result).toEqual({ ok: true });
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('session='));
  });

  it('revokeSession отзывает конкретную сессию', async () => {
    const sessions = { revoke: vi.fn().mockResolvedValue(undefined) } as never;
    const ctrl = new AuthController(sessions);
    const res = { setHeader: vi.fn() } as unknown as Response;
    const result = await ctrl.revokeSession('s2', mockUser, 's1', res);
    expect(result).toEqual({ ok: true });
    expect(sessions.revoke).toHaveBeenCalledWith('s2', 'u1');
    expect(res.setHeader).not.toHaveBeenCalled(); // not current session
  });

  it('revokeSession сбрасывает cookie при отзыве текущей сессии', async () => {
    const sessions = { revoke: vi.fn().mockResolvedValue(undefined) } as never;
    const ctrl = new AuthController(sessions);
    const res = { setHeader: vi.fn() } as unknown as Response;
    const result = await ctrl.revokeSession('s1', mockUser, 's1', res);
    expect(result).toEqual({ ok: true });
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
  });
});

// ── Config defaults ─────────────────────────────────────────────────────────

import { loadApiConfig } from '../src/config.js';

describe('A-04 · ApiConfig.allowedOrigins', () => {
  it('разбирает список разрешённых origin из ALLOWED_ORIGINS', () => {
    const config = loadApiConfig({ ALLOWED_ORIGINS: 'https://blokum.ru,https://www.blokum.ru' });
    expect(config.allowedOrigins).toEqual(['https://blokum.ru', 'https://www.blokum.ru']);
  });
  it('по умолчанию localhost:3110', () => {
    const config = loadApiConfig({});
    expect(config.allowedOrigins).toContain('http://localhost:3110');
  });
});
