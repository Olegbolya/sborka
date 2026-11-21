import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { WebhooksService } from './webhooks.service.js';

/** D-07 · the webhook of a project («Про»): the owner sets the address, sees the secret and the last deliveries, sends a check. */
@Controller('projects/:id/webhook')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  view(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.webhooks.view(user.id, id);
  }

  @Put()
  save(@Param('id') id: string, @Body() body: { url?: unknown; enabled?: unknown } | null, @CurrentUser() user: RequestUser) {
    return this.webhooks.save(user.id, id, body ?? {});
  }

  @Delete()
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    await this.webhooks.remove(user.id, id);
  }

  @Post('secret')
  @HttpCode(200)
  rotate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.webhooks.rotateSecret(user.id, id);
  }

  @Post('test')
  @HttpCode(200)
  test(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.webhooks.test(user.id, id);
  }

  @Post('deliveries/:deliveryId/retry')
  @HttpCode(200)
  retry(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @CurrentUser() user: RequestUser) {
    return this.webhooks.retry(user.id, id, deliveryId);
  }
}
