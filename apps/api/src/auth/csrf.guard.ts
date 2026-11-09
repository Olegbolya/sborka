import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SKIP_CSRF_KEY } from './decorators.js';
import { API_CONFIG } from '../tokens.js';
import type { ApiConfig } from '../config.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A-04 / §8.1: CSRF protection for mutating requests. Requires either:
 * - `Origin` header matching an allowed origin, OR
 * - `X-Blokum-CSRF: 1` header (for server-to-server / test requests).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly reflector?: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method.toUpperCase())) return true;
    if (this.reflector?.getAllAndOverride<boolean | undefined>(SKIP_CSRF_KEY, [ctx.getHandler(), ctx.getClass()])) return true;

    const csrfHeader = req.headers['x-blokum-csrf'];
    if (csrfHeader === '1') return true;

    const origin = req.headers['origin'];
    if (origin && this.config.allowedOrigins.includes(origin)) return true;

    throw new ForbiddenException('Недействительный запрос: отсутствует или не совпадает заголовок Origin');
  }
}
