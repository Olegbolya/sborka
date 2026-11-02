import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { ProjectsService } from './projects.service.js';

/** ME-01, ME-02 · creator's saved elements: save blocks-with-rules, list, get fragment, delete. */
@Controller('elements')
export class ElementsController {
  constructor(private readonly projects: ProjectsService) {}

  /** ME-01 · list saved elements of the signed-in creator. */
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.projects.listElements(user.id).then((elements) => ({ elements }));
  }

  /** ME-01 · save blocks (fragment: ClipboardPayload) as a named element. */
  @Post()
  @HttpCode(200)
  save(@Body() body: { name?: unknown; fragment?: unknown } | null, @CurrentUser() user: RequestUser) {
    const name = typeof body?.name === 'string' ? body.name : '';
    const fragment = body?.fragment && typeof body.fragment === 'object' ? (body.fragment as Record<string, unknown>) : {};
    return this.projects.saveElement(user.id, name, fragment);
  }

  /** ME-02 · get the full fragment of a saved element for insertion into a project. */
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.getElement(user.id, id);
  }

  /** ME-01 · delete a saved element. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.projects.deleteElement(user.id, id);
  }
}
