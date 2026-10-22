import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
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
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method.toUpperCase())) return true;

    const csrfHeader = req.headers['x-blokum-csrf'];
    if (csrfHeader === '1') return true;

    const origin = req.headers['origin'];
    if (origin && this.config.allowedOrigins.includes(origin)) return true;

    throw new ForbiddenException('Недействительный запрос: отсутствует или не совпадает заголовок Origin');
  }
}
