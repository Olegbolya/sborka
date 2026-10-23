import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiConfig } from '../config.js';
import { API_CONFIG } from '../tokens.js';
import { Public } from './decorators.js';
import { OtpService } from './otp.service.js';
import { sessionCookieHeader } from './session.service.js';

class RequestCodeDto {
  phone!: string;
  captchaToken!: string;
}

class VerifyCodeDto {
  phone!: string;
  code!: string;
}

class VerifyTotpDto {
  phone!: string;
  code!: string;
}

@Public()
@Controller('auth/otp')
export class OtpController {
  constructor(
    private readonly otp: OtpService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** A-01, TS-30: request an OTP code for the given phone number. */
  @Post('request')
  @HttpCode(200)
  async requestCode(@Body() body: RequestCodeDto, @Req() req: Request): Promise<{ ok: true }> {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? '0.0.0.0';
    await this.otp.requestCode(body.phone, body.captchaToken ?? '', ip);
    return { ok: true };
  }

  /** A-01: verify OTP code; sets session cookie or returns requiresTotp for 2FA accounts. */
  @Post('verify')
  @HttpCode(200)
  async verifyCode(@Body() body: VerifyCodeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ requiresTotp: true } | { user: { id: string; role: string; displayName: string } }> {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? '0.0.0.0';
    const ua = req.headers['user-agent'] ?? '';
    const result = await this.otp.verifyCode(body.phone, body.code, ip, ua);
    if (result.requiresTotp) return { requiresTotp: true };
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', sessionCookieHeader(result.token, secure));
    return { user: { id: result.user.id, role: result.user.role, displayName: result.user.displayName } };
  }

  /** AD-01: second factor — verify TOTP or backup code after OTP; sets session cookie. */
  @Post('totp-verify')
  @HttpCode(200)
  async verifyTotp(@Body() body: VerifyTotpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ user: { id: string; role: string; displayName: string } }> {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? '0.0.0.0';
    const ua = req.headers['user-agent'] ?? '';
    const { token, user } = await this.otp.verifyTotp(body.phone, body.code, ip, ua);
    const secure = this.config.databaseUrl.includes('ssl') || process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', sessionCookieHeader(token, secure));
    return { user: { id: user.id, role: user.role, displayName: user.displayName } };
  }
}
