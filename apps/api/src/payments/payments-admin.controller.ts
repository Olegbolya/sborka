import { Body, Controller, Get, Ip, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { PaymentsAdminService } from './payments-admin.service.js';

/** AD-05, AD-12 · payments in the admin: orders, returns, gifts by hand, the income of the self-employed. Only for an administrator. */
@Roles('ADMIN')
@Controller('admin/payments')
export class PaymentsAdminController {
  constructor(private readonly admin: PaymentsAdminService) {}

  @Get('income')
  income() {
    return this.admin.income();
  }

  @Put('income-limit')
  setLimit(@Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.setLimit(user.id, body?.rub, ip);
  }

  @Get('orders')
  orders(@Query('status') status?: string, @Query('kind') kind?: string, @Query('q') q?: string, @Query('page') page?: string) {
    return this.admin.orders({ ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(q ? { q } : {}), page: Number(page) || 0 });
  }

  @Patch('orders/:id/payer')
  payer(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.setPayer(user.id, id, body ?? {}, ip);
  }

  @Post('orders/:id/refund')
  refund(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.refund(user.id, id, body?.reason, ip);
  }

  @Post('grants')
  grant(@Body() body: Record<string, unknown>, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.admin.grant(user.id, body ?? {}, ip);
  }
}
