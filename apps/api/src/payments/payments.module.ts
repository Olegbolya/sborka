import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, PAYMENT_PROVIDER } from '../tokens.js';
import { type PaymentProvider } from './payment-provider.js';
import { BillingService } from './billing.service.js';
import { NpdIncomeService } from './npd-income.service.js';
import { PaymentsAdminController } from './payments-admin.controller.js';
import { PaymentsAdminService } from './payments-admin.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PromoAdminController } from './promo-admin.controller.js';
import { PromoService } from './promo.service.js';
import { YooKassaProvider } from './yookassa.provider.js';

@Module({})
export class PaymentsModule {
  /** `provider` — для тестов; без него берётся ЮKassa из окружения, а если ключей нет, оплата отвечает «не подключена». */
  static register(config: ApiConfig, provider?: PaymentProvider | null): DynamicModule {
    const resolved = provider !== undefined ? provider : config.yookassa ? new YooKassaProvider(config.yookassa.shopId, config.yookassa.secretKey) : null;
    return {
      module: PaymentsModule,
      controllers: [PaymentsController, PromoAdminController, PaymentsAdminController],
      providers: [PaymentsService, PaymentsAdminService, NpdIncomeService, PromoService, BillingService, { provide: API_CONFIG, useValue: config }, { provide: PAYMENT_PROVIDER, useValue: resolved }],
    };
  }
}
