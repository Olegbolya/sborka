import { Controller, Delete, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentSessionId, CurrentUser } from './decorators.js';
import { SessionService, type SessionListItem, type RequestUser, clearSessionCookieHeader } from './session.service.js';

/** A-04: session management endpoints. All require a valid session (AuthGuard is global). */
@Controller('auth')
export class AuthController {
  constructor(private readonly sessions: SessionService) {}

  /** A-01: return the authenticated user's profile. */
  @Get('me')
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  /** A-04: list active sessions for the current user. */
  @Get('sessions')
  async listSessions(
    @CurrentUser() user: RequestUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<{ sessions: SessionListItem[] }> {
    const sessions = await this.sessions.list(user.id, sessionId);
    return { sessions };
  }

  /** A-04: revoke all sessions for the current user («выйти везде»). */
  @Delete('sessions')
  async logoutEverywhere(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.sessions.revokeAll(user.id);
    res.setHeader('Set-Cookie', clearSessionCookieHeader(process.env.NODE_ENV === 'production'));
    return { ok: true };
  }

  /** A-04: revoke a specific session by ID. */
  @Delete('sessions/:id')
  async revokeSession(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @CurrentSessionId() sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    if (!(await this.sessions.revoke(id, user.id))) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Такого входа нет' } });
    if (id === sessionId) {
      res.setHeader('Set-Cookie', clearSessionCookieHeader(process.env.NODE_ENV === 'production'));
    }
    return { ok: true };
  }
}
