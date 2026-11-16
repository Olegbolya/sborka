import { Controller, Delete, Get, Headers, HttpCode, Post, Body } from '@nestjs/common';
import { CurrentUser, Public, SkipCsrf } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { TelegramService } from './telegram.service.js';

/** D-07 · linking of the creator's Telegram chat (in «Настройки»). */
@Controller('account/telegram')
export class TelegramAccountController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status(@CurrentUser() user: RequestUser) {
    return this.telegram.status(user.id);
  }

  @Post('link')
  @HttpCode(200)
  link(@CurrentUser() user: RequestUser) {
    return this.telegram.startLink(user.id);
  }

  @Delete()
  @HttpCode(204)
  async unlink(@CurrentUser() user: RequestUser): Promise<void> {
    await this.telegram.unlink(user.id);
  }
}

/** D-07 · where Telegram sends what people write to the bot. It has no Origin and no session: the secret of the webhook proves it is Telegram. */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly telegram: TelegramService) {}

  @Public()
  @SkipCsrf()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: unknown): Promise<{ ok: boolean }> {
    if (!this.telegram.secretMatches(secret)) return { ok: false };
    await this.telegram.handleUpdate(update).catch(() => undefined);
    return { ok: true };
  }
}
