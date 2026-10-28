import { Body, Controller, Get, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/decorators.js';
import { type RequestUser } from '../auth/session.service.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { ModerationService } from './moderation.service.js';
import { NotificationsService } from './notifications.service.js';

/** The creator's side of moderation: why a project is closed, the appeal against it (docs/06-TRUST-SAFETY.md §5) and the messages. */
@Controller()
export class CreatorModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly notices: NotificationsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('projects/:id/moderation')
  view(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.moderation.creatorView(user.id, id);
  }

  @Post('projects/:id/appeals')
  @HttpCode(201)
  appeal(@Param('id') id: string, @Body() body: { text?: unknown }, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.moderation.appeal(user.id, id, body?.text, ip);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: RequestUser) {
    return this.notices.list(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.notices.markRead(user.id, id);
  }

  /** AD-07 · what the site must know to show or hide things (external links go through `/out`). */
  @Public()
  @Get('flags/public')
  async publicFlags() {
    return { externalLinks: await this.flags.isEnabled('EXTERNAL_LINKS_ENABLED'), player: await this.flags.isEnabled('PLAYER_ENABLED') };
  }
}
