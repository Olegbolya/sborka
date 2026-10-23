import { BadRequestException, Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../tokens.js';
import { Public } from './decorators.js';
import { type OAuthProvider, OAuthService } from './oauth.service.js';
import { sessionCookieHeader } from './session.service.js';

@Public()
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
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
      throw new BadRequestException({ error: { code: 'OAUTH_MISSING_PARAMS', message: 'Отсутствуют параметры code или state' } });
    }
    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';
    const ua = req.headers['user-agent'] ?? '';
    const { token } = await this.oauth.processCallback(p, code, state, ip, ua);
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', sessionCookieHeader(token, secure));
    res.redirect(302, this.config.webUrl);
  }

  private assertProvider(raw: string): OAuthProvider {
    if (raw === 'vk' || raw === 'yandex') return raw;
    throw new BadRequestException({ error: { code: 'UNKNOWN_OAUTH_PROVIDER', message: `Неизвестный провайдер: ${raw}` } });
  }
}
