import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './decorators.js';
import { CurrentUser } from './decorators.js';
import type { RequestUser } from './session.service.js';
import { AccountService, type ExportData } from './account.service.js';
import { parseSessionCookie } from './session.service.js';
import { SessionService } from './session.service.js';

class UpdateProfileDto {
  displayName?: string;
}

class RequestEmailDto {
  email!: string;
}

/** A-03, A-05, D-10: user account management endpoints. */
@Controller('auth/account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly sessions: SessionService,
  ) {}

  /** D-10: get current user profile. */
  @Get()
  async getProfile(@CurrentUser() user: RequestUser) {
    return this.account.getProfile(user.id);
  }

  /** D-10: update display name. */
  @Patch()
  @HttpCode(200)
  async updateProfile(@Body() body: UpdateProfileDto, @CurrentUser() user: RequestUser): Promise<{ ok: true }> {
    if (body.displayName !== undefined) {
      await this.account.updateDisplayName(user.id, body.displayName);
    }
    return { ok: true };
  }

  /** A-03: request email change — sends verification link. */
  @Post('email')
  @HttpCode(200)
  async requestEmail(@Body() body: RequestEmailDto, @CurrentUser() user: RequestUser): Promise<{ ok: true }> {
    await this.account.requestEmailVerification(user.id, body.email ?? '');
    return { ok: true };
  }

  /** A-03: verify email via token link (public, no auth required). */
  @Public()
  @Get('email/verify')
  async verifyEmail(@Query('token') token: string, @Res() res: Response): Promise<void> {
    await this.account.verifyEmail(token ?? '');
    res.redirect('/account?emailVerified=1');
  }

  /** D-10: list active sessions. */
  @Get('sessions')
  async getSessions(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const cookie = req.headers['cookie'] ?? '';
    const currentToken = parseSessionCookie(cookie) ?? '';
    const currentHash = currentToken
      ? createHash('sha256').update(currentToken).digest('hex')
      : '';
    return this.account.getSessions(user.id, currentHash);
  }

  /** D-10: consent history. */
  @Get('consents')
  async getConsents(@CurrentUser() user: RequestUser) {
    return this.account.getConsentHistory(user.id);
  }

  /** D-10: revoke marketing consent. */
  @Delete('consents/marketing')
  @HttpCode(200)
  async revokeMarketing(@CurrentUser() user: RequestUser): Promise<{ ok: true }> {
    await this.account.revokeMarketingConsent(user.id);
    return { ok: true };
  }

  /** D-10: export all user data as JSON download. */
  @Post('export')
  @HttpCode(200)
  async exportData(@CurrentUser() user: RequestUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    const cookie = req.headers['cookie'] ?? '';
    const currentToken = parseSessionCookie(cookie) ?? '';
    const currentHash = currentToken
      ? createHash('sha256').update(currentToken).digest('hex')
      : '';
    const data: ExportData = await this.account.exportData(user.id, currentHash);
    const json = JSON.stringify(data, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="blokum-export-${user.id}.json"`);
    res.send(json);
  }

  /** A-05: soft-delete account. */
  @Delete()
  @HttpCode(200)
  async deleteAccount(@CurrentUser() user: RequestUser): Promise<{ ok: true }> {
    await this.account.deleteAccount(user.id);
    return { ok: true };
  }

  /** A-05: restore account within 30-day grace period. */
  @Post('restore')
  @HttpCode(200)
  async restoreAccount(@CurrentUser() user: RequestUser): Promise<{ ok: true }> {
    await this.account.restoreAccount(user.id);
    return { ok: true };
  }

  /** AD-01: begin TOTP setup — returns QR URI. */
  @Post('totp/setup')
  @HttpCode(200)
  async setupTotp(@CurrentUser() user: RequestUser): Promise<{ totpUri: string }> {
    return this.account.setupTotp(user.id);
  }

  /** AD-01: confirm TOTP with first valid code; returns one-time backup codes. */
  @Post('totp/confirm')
  @HttpCode(200)
  async confirmTotp(@Body() body: { code: string }, @CurrentUser() user: RequestUser): Promise<{ backupCodes: string[] }> {
    return this.account.confirmTotp(user.id, body.code ?? '');
  }

  /** AD-01: disable TOTP (removes secret and backup codes). */
  @Delete('totp')
  @HttpCode(200)
  async disableTotp(@CurrentUser() user: RequestUser, @Req() req: Request): Promise<{ ok: true }> {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress;
    await this.account.disableTotp(user.id, ip);
    return { ok: true };
  }
}
