import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { type OperatorInfo, type ProjectSettings, ProjectsService } from './projects.service.js';

/** P6.1 · D-01: My projects CRUD + settings + status. */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** D-01: List projects with optional search and status filter. */
  @Get()
  list(@CurrentUser() user: RequestUser, @Query('search') search?: string, @Query('status') status?: string) {
    return this.projects.listProjects(user.id, { search, status });
  }

  /** D-01: Create a new project. */
  @Post()
  @HttpCode(200)
  create(@Body() body: { title?: string }, @CurrentUser() user: RequestUser) {
    return this.projects.createProject(user.id, body.title);
  }

  /** D-01: Get a project with its current draft. */
  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.getProject(user.id, id);
  }

  /** D-01: Update project title. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { title?: string }, @CurrentUser() user: RequestUser) {
    return this.projects.updateProject(user.id, id, body);
  }

  /** D-01: Soft-delete a project (restore within 30 days). */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.deleteProject(user.id, id);
  }

  /** D-01: Restore a soft-deleted project. */
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.restoreProject(user.id, id);
  }

  /** D-01: Duplicate a project. */
  @Post(':id/duplicate')
  @HttpCode(200)
  duplicate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.duplicateProject(user.id, id);
  }

  /** D-01/D-03: Change project status (PUBLISHED | CLOSED | DRAFT). */
  @Post(':id/status')
  @HttpCode(200)
  setStatus(@Param('id') id: string, @Body() body: { status: 'PUBLISHED' | 'CLOSED' | 'DRAFT' }, @CurrentUser() user: RequestUser) {
    return this.projects.setProjectStatus(user.id, id, body.status);
  }

  /** L-08, SC-07 · publishes the draft: errors of the check block it (422 with the list), otherwise a published version is made. */
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.setProjectStatus(user.id, id, 'PUBLISHED');
  }

  /** D-03: Get access settings (limits, schedule, password…). */
  @Get(':id/access-settings')
  getAccessSettings(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.getAccessSettings(user.id, id);
  }

  /** D-03: Update access settings. */
  @Patch(':id/access-settings')
  updateAccessSettings(@Param('id') id: string, @Body() body: Partial<ProjectSettings>, @CurrentUser() user: RequestUser) {
    return this.projects.updateAccessSettings(user.id, id, body);
  }

  /** PL-18: the advertising mark of the project (or `null`). */
  @Get(':id/advertising')
  getAdvertising(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.getAdvertising(user.id, id).then((ad) => ({ ad }));
  }

  /** PL-18: «Это реклама» — advertiser, INN, erid; an empty body turns the mark off. */
  @Patch(':id/advertising')
  async setAdvertising(@Param('id') id: string, @Body() body: { advertiser?: unknown; inn?: unknown; erid?: unknown } | null, @CurrentUser() user: RequestUser) {
    return { ad: await this.projects.setAdvertising(user.id, id, body ?? null) };
  }

  /** PL-23: Get operator info and DPA status for participant PD. */
  @Get(':id/operator-info')
  getOperatorInfo(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.getOperatorInfo(user.id, id);
  }

  /** PL-23: Set operator info (name, email, inn, purpose, retentionPeriod). */
  @Patch(':id/operator-info')
  setOperatorInfo(@Param('id') id: string, @Body() body: OperatorInfo, @CurrentUser() user: RequestUser) {
    return this.projects.setOperatorInfo(user.id, id, body);
  }

  /** PL-23: Accept DPA (D6 — условия поручения обработки ПД) for this project. */
  @Post(':id/dpa-accept')
  @HttpCode(200)
  acceptDpa(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.acceptDpa(user.id, id);
  }
}
