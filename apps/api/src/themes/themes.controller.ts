import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { ThemesService } from './themes.service.js';

/** TH-01…TH-03 · themes. */
@Controller('themes')
export class ThemesController {
  constructor(private readonly themes: ThemesService) {}

  @Get()
  list(@Query('scope') scope: string | undefined, @CurrentUser() user: RequestUser) {
    return this.themes.list(user.id, scope === 'system' ? 'system' : 'mine');
  }

  @Post()
  create(@Body() body: { name?: unknown; tokens?: unknown }, @CurrentUser() user: RequestUser) {
    return this.themes.create(user.id, body?.name, body?.tokens);
  }

  @Post('from-project/:projectId')
  fromProject(
    @Param('projectId') projectId: string,
    @Body() body: { name?: unknown },
    @CurrentUser() user: RequestUser,
  ) {
    return this.themes.fromProject(user.id, projectId, body?.name);
  }

  @Post('from-image')
  fromImage(@Body() body: { mediaId?: unknown; name?: unknown }, @CurrentUser() user: RequestUser) {
    return this.themes.fromImage(user.id, body?.mediaId, body?.name);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.themes.get(user.id, id);
  }

  @Put(':id')
  @HttpCode(200)
  update(
    @Param('id') id: string,
    @Body() body: { name?: unknown; tokens?: unknown },
    @CurrentUser() user: RequestUser,
  ) {
    return this.themes.update(user.id, id, body ?? {});
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.themes.remove(user.id, id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.themes.duplicate(user.id, id);
  }

  @Post(':id/default')
  @HttpCode(200)
  setDefault(@Param('id') id: string, @Body() body: { value?: unknown }, @CurrentUser() user: RequestUser) {
    return this.themes.setDefault(user.id, id, body?.value !== false);
  }
}
