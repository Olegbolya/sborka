import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RequestUser } from './session.service.js';
import { SessionService, parseSessionCookie } from './session.service.js';
import { IS_PUBLIC_KEY } from './decorators.js';

/** Validates the session cookie on every request and attaches `user` + `sessionId` to the request object. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: RequestUser; sessionId?: string }>();
    const token = parseSessionCookie(req.headers['cookie']);
    if (!token) throw new UnauthorizedException('Требуется авторизация');

    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException('Сессия недействительна или истекла');

    req.user = session.user;
    req.sessionId = session.id;
    return true;
  }
}
