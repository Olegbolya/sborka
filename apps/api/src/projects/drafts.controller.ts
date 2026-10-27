import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { DraftsService } from './drafts.service.js';

/** P3.2 · E-17…E-19: saving the draft, history of versions. */
@Controller('projects/:id')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  /** E-17/E-18: `If-Match` — the revision the page was loaded with, or `*` to overwrite. 409 when it is stale. */
  @Put('draft')
  @HttpCode(200)
  save(@Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Body() body: { document?: unknown }, @CurrentUser() user: RequestUser) {
    return this.drafts.saveDraft(user.id, id, ifMatch, body?.document);
  }

  @Get('versions')
  list(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.drafts.listVersions(user.id, id);
  }

  @Get('versions/:versionId')
  getOne(@Param('id') id: string, @Param('versionId') versionId: string, @CurrentUser() user: RequestUser) {
    return this.drafts.getVersion(user.id, id, versionId);
  }

  @Post('restore/:versionId')
  @HttpCode(200)
  restore(@Param('id') id: string, @Param('versionId') versionId: string, @CurrentUser() user: RequestUser) {
    return this.drafts.restoreVersion(user.id, id, versionId);
  }
}
