import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, Public, SkipCsrf } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { BillingService } from './billing.service.js';
import { type OrderRequest, PaymentsService } from './payments.service.js';

/** P7.3 · оплата: создать заказ, посмотреть свои заказы; уведомления провайдера приходят на отдельный адрес. */
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly billing: BillingService,
  ) {}

  @Get('billing/me')
  state(@CurrentUser() user: RequestUser) {
    return this.billing.state(user.id);
  }

  @Post('billing/trial')
  @HttpCode(200)
  trial(@Body() body: { planCode?: unknown }, @CurrentUser() user: RequestUser) {
    return this.billing.startTrial(user.id, body?.planCode);
  }

  @Post('orders')
  @HttpCode(201)
  create(@Body() body: OrderRequest, @CurrentUser() user: RequestUser) {
    return this.payments.createOrder(user.id, body ?? {});
  }

  @Get('orders')
  async mine(@CurrentUser() user: RequestUser) {
    return { orders: await this.payments.myOrders(user.id) };
  }

  /** Уведомления ЮKassa. Без сессии и без Origin; подлинность — повторная проверка платежа у провайдера. */
  @Public()
  @SkipCsrf()
  @Post('payments/yookassa/notify')
  @HttpCode(200)
  notify(@Body() body: unknown) {
    return this.payments.handleNotification(body);
  }
}
