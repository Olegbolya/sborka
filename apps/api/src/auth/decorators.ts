import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from './session.service.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Mark an endpoint as public — AuthGuard skips session validation. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Require specific role(s); used together with RolesGuard (which runs after AuthGuard). */
export const Roles = (...roles: Array<RequestUser['role']>) => SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated user into a controller parameter. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  return (ctx.switchToHttp().getRequest<Request & { user: RequestUser }>()).user;
});

/** Injects the current session ID into a controller parameter. */
export const CurrentSessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return (ctx.switchToHttp().getRequest<Request & { sessionId: string }>()).sessionId;
});
