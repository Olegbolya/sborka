import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { ProjectsService } from './projects.service.js';

/** The fields of a rename / cover change; anything else is ignored, a wrong type is refused as «nothing to change». */
export function patchOf(body: { name?: unknown; coverMediaId?: unknown } | null): { name?: string; coverMediaId?: string | null } {
  const patch: { name?: string; coverMediaId?: string | null } = {};
  if (typeof body?.name === 'string') patch.name = body.name;
  if (typeof body?.coverMediaId === 'string' || body?.coverMediaId === null) patch.coverMediaId = body.coverMediaId;
  return patch;
}

/** TPL-01..04 · user and system templates gallery, save-as-template, insert-screen-from-template. */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly projects: ProjectsService) {}

  /**
   * TPL-03 · system templates for the gallery, with optional search and category filter.
   * Own templates (TPL-02) are listed via GET /templates/mine.
   */
  @Get()
  async list(@Query('category') category?: string, @Query('search') search?: string) {
    const all = await this.projects.listSystemTemplates();
    let result = all;
    if (category) result = result.filter((t) => t.category === category);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }
    return { templates: result };
  }

  /** TPL-02 · the creator's own saved templates. */
  @Get('mine')
  async mine(@CurrentUser() user: RequestUser) {
    return { templates: await this.projects.listOwnTemplates(user.id) };
  }

  /** TPL-01 · save the current document of a project as the creator's own template. */
  @Post()
  @HttpCode(200)
  save(@Body() body: { projectId?: unknown; name?: unknown } | null, @CurrentUser() user: RequestUser) {
    const projectId = typeof body?.projectId === 'string' ? body.projectId : '';
    const name = typeof body?.name === 'string' ? body.name : undefined;
    return this.projects.saveProjectAsTemplate(user.id, projectId, name);
  }

  /** TPL-02 · the screens and variables of a template, to insert one screen into an assembly. */
  @Get(':id')
  content(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.templateContent(user.id, id);
  }

  /** TPL-02 · rename the creator's own template and/or set its cover (`coverMediaId: null` takes it off). */
  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: { name?: unknown; coverMediaId?: unknown } | null, @CurrentUser() user: RequestUser) {
    await this.projects.updateOwnTemplate(user.id, id, patchOf(body));
    return { ok: true };
  }

  /** TPL-02 · delete the creator's own template. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.deleteOwnTemplate(user.id, id);
  }
}
