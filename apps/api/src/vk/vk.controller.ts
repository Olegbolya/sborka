import { Body, Controller, Delete, Get, Header, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, Public, SkipCsrf } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { VkService } from './vk.service.js';

/** D-07 · linking of the creator's VK dialog (in «Настройки»). */
@Controller('account/vk')
export class VkAccountController {
  constructor(private readonly vk: VkService) {}

  @Get()
  status(@CurrentUser() user: RequestUser) {
    return this.vk.status(user.id);
  }

  @Post('link')
  @HttpCode(200)
  link(@CurrentUser() user: RequestUser) {
    return this.vk.startLink(user.id);
  }

  @Delete()
  @HttpCode(204)
  async unlink(@CurrentUser() user: RequestUser): Promise<void> {
    await this.vk.unlink(user.id);
  }
}

/** D-07 · Callback API of the community: no Origin and no session; the secret in the body proves it is VK. VK reads the answer as plain text. */
@Controller('vk')
export class VkCallbackController {
  constructor(private readonly vk: VkService) {}

  @Public()
  @SkipCsrf()
  @Post('callback')
  @HttpCode(200)
  @Header('content-type', 'text/plain; charset=utf-8')
  callback(@Body() event: unknown): Promise<string> {
    return this.vk.handleEvent(event).catch(() => 'ok');
  }
}
