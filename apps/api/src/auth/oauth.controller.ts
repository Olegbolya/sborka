import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../tokens.js';
import { Public } from './decorators.js';
import { type OAuthProvider, OAuthService } from './oauth.service.js';
import { sessionCookieHeader } from './session.service.js';
import { AdminMfaService, MFA_COOKIE } from './admin-mfa.service.js';

const cookieOf = (req: Request, name: string): string | undefined => req.headers.cookie?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
const mfaCookie = (value: string, secure: boolean, maxAgeSec = 600): string => `${MFA_COOKIE}=${value}; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
const clientOf = (req: Request): { ip: string; ua: string } => {
  const fwd = req.headers['x-forwarded-for'];
  return { ip: (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '', ua: req.headers['user-agent'] ?? '' };
};

@Public()
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly mfa: AdminMfaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get(':provider/init')
  async init(@Param('provider') provider: string, @Res() res: Response): Promise<void> {
    const p = this.assertProvider(provider);
    const url = await this.oauth.initFlow(p);
    res.redirect(302, url);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const p = this.assertProvider(provider);
    if (!code || !state) {
      // A refusal at the provider comes back without a code.
      res.redirect(302, `${this.config.webUrl}/login?error=oauth`);
      return;
    }
    const { ip, ua } = clientOf(req);
    let result: Awaited<ReturnType<OAuthService['processCallback']>>;
    try {
      result = await this.oauth.processCallback(p, code, state, ip, ua);
    } catch (e) {
      // The participant sees the login page with a Russian message, not a JSON error page.
      if (e instanceof BadRequestException) {
        res.redirect(302, `${this.config.webUrl}/login?error=oauth`);
        return;
      }
      throw e;
    }
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    if ('mfa' in result) {
      // AD-01: no session yet — the second factor comes first.
      res.setHeader('Set-Cookie', mfaCookie(result.mfa, secure));
      res.redirect(302, `${this.config.webUrl}/login/2fa`);
      return;
    }
    res.setHeader('Set-Cookie', sessionCookieHeader(result.token, secure));
    // The onboarding page sends a user who has already accepted everything straight to the cabinet.
    res.redirect(302, `${this.config.webUrl}/onboarding`);
  }

  /** AD-01 · what the second step needs: the code, or (the first time) the secret to put into an authenticator. */
  @Post('mfa/start')
  @HttpCode(200)
  async mfaStart(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    const started = await this.mfa.start(cookieOf(req, MFA_COOKIE));
    res.setHeader('Set-Cookie', mfaCookie(started.pending, secure));
    const { pending: _pending, ...rest } = started;
    return rest;
  }

  /** AD-01 · the code is right: the session begins (and the first time the backup codes are shown once). */
  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(@Body() body: { code?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    const { ip, ua } = clientOf(req);
    const { token, user, backupCodes } = await this.mfa.verify(cookieOf(req, MFA_COOKIE), body?.code, ip, ua);
    res.setHeader('Set-Cookie', [sessionCookieHeader(token, secure), mfaCookie('', secure, 0)]);
    return { user: { id: user.id, role: user.role, displayName: user.displayName }, ...(backupCodes ? { backupCodes } : {}) };
  }

  private assertProvider(raw: string): OAuthProvider {
    if (raw === 'vk' || raw === 'yandex') return raw;
    throw new BadRequestException({ error: { code: 'UNKNOWN_OAUTH_PROVIDER', message: `Неизвестный провайдер: ${raw}` } });
  }
}
