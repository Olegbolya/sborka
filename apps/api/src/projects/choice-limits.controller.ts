import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { ChoiceLimitsService } from './choice-limits.service.js';

/** D-12 · the places of limited options (B-24) of a project: who holds each, and the manual release. */
@Controller('projects/:projectId/choice-limits')
export class ChoiceLimitsController {
  constructor(private readonly limits: ChoiceLimitsService) {}

  @Get()
  list(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser) {
    return this.limits.list(user.id, projectId);
  }

  @Post('release')
  @HttpCode(204)
  async release(@Param('projectId') projectId: string, @Body() body: { sessionId?: unknown; optionId?: unknown } | null, @CurrentUser() user: RequestUser) {
    await this.limits.release(user.id, projectId, body?.sessionId, body?.optionId);
  }
}
