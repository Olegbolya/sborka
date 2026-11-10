import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { AnalyticsService } from './analytics.service.js';

/** P6.5 · D-05: the analytics of a project: the days, the access points, the devices, the funnel by screens, the answers, the results. */
@Controller('projects/:projectId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  stats(@Param('projectId') projectId: string, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @CurrentUser() user: RequestUser) {
    return this.analytics.analytics(user.id, projectId, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
}
