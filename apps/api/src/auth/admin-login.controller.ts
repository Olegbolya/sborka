import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../tokens.js';
import { AdminPasswordService } from './admin-password.service.js';
import { MFA_COOKIE } from './admin-mfa.service.js';
import { CurrentUser, Public, Roles } from './decorators.js';
import type { RequestUser } from './session.service.js';

const clientIp = (req: Request): string => {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';
};

/** AD-01 · sign-in of administrators and moderators by login and password (the code of the authenticator follows on /login/2fa). */
@Controller('auth/admin')
export class AdminLoginController {
  constructor(
    private readonly passwords: AdminPasswordService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { login?: unknown; password?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ next: string }> {
    const { pending } = await this.passwords.login(body?.login, body?.password, clientIp(req));
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    // The same half-finished sign-in as after a provider: the cookie is read by the second step.
    res.setHeader('Set-Cookie', `${MFA_COOKIE}=${pending}; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`);
    return { next: '/login/2fa?to=admin' };
  }

  @Roles('ADMIN', 'MODERATOR')
  @Post('password')
  @HttpCode(200)
  async change(@Body() body: { oldPassword?: unknown; newPassword?: unknown }, @CurrentUser() user: RequestUser, @Req() req: Request): Promise<{ ok: true }> {
    await this.passwords.change(user.id, body?.oldPassword, body?.newPassword, clientIp(req));
    return { ok: true };
  }
}
