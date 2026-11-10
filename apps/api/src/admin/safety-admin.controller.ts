import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { SafetyService } from './safety.service.js';

/** TS-04, TS-05 · the stop words (with weights) and the stop-list of domains: only an administrator edits them; every change is in the audit log. */
@Roles('ADMIN')
@Controller('admin/safety-terms')
export class SafetyAdminController {
  constructor(private readonly safety: SafetyService) {}

  @Get()
  async list() {
    return { terms: await this.safety.list() };
  }

  @Post()
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.safety.create(user.id, body ?? {}, ip);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.safety.update(user.id, id, body ?? {}, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.safety.remove(user.id, id, ip);
  }
}
