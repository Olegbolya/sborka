import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RequestUser } from './session.service.js';
import { ROLES_KEY } from './decorators.js';

/** AD-01: Checks that the authenticated user has the required role(s). Runs after AuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Array<RequestUser['role']>>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    if (!req.user || !required.includes(req.user.role)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}
