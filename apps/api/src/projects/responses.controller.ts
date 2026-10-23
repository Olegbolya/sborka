import { Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { ResponsesService } from './responses.service.js';
import { ExportService } from './export.service.js';

/** P6.4/P6.6 · D-04/D-06: Responses table, card, delete, viewed, export. */
@Controller('projects/:projectId/responses')
export class ResponsesController {
  constructor(
    private readonly responses: ResponsesService,
    private readonly exportSvc: ExportService,
  ) {}

  /** D-04: Paginated list of responses for a project. */
  @Get()
  list(
    @Param('projectId') projectId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.responses.listResponses(user.id, projectId, { cursor, limit: limit ? Number(limit) : undefined, status });
  }

  /** D-06: Export responses as CSV. */
  @Get('export.csv')
  async exportCsv(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser, @Res() res: Response) {
    const buf = await this.exportSvc.exportCsv(user.id, projectId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="responses-${projectId}.csv"`);
    res.end(buf);
  }

  /** D-06: Export responses as XLSX. */
  @Get('export.xlsx')
  async exportXlsx(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser, @Res() res: Response) {
    const buf = await this.exportSvc.exportXlsx(user.id, projectId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="responses-${projectId}.xlsx"`);
    res.end(buf);
  }

  /** D-04: Get a single response with its answers. */
  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.responses.getResponse(user.id, id);
  }

  /** D-04: Delete a response. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.responses.deleteResponse(user.id, id);
  }

  /** D-04: Mark a response as viewed. */
  @Post(':id/viewed')
  @HttpCode(204)
  markViewed(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.responses.markViewed(user.id, id);
  }
}
