import { Body, Controller, Get, Ip, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { PromoService } from './promo.service.js';

/** AD-05 · promo codes in the admin: only an administrator creates and changes them; every change goes to the audit log. */
@Roles('ADMIN')
@Controller('admin/promo-codes')
export class PromoAdminController {
  constructor(private readonly promos: PromoService) {}

  @Get()
  async list() {
    return { codes: await this.promos.list() };
  }

  @Post()
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.promos.create(user.id, body ?? {}, ip);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.promos.update(user.id, id, body ?? {}, ip);
  }
}
