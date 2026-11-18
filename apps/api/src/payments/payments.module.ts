import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, PAYMENT_PROVIDER, PAYMENT_PROVIDERS } from '../tokens.js';
import { type PaymentProvider } from './payment-provider.js';
import { BillingService } from './billing.service.js';
import { NpdIncomeService } from './npd-income.service.js';
import { PaymentsAdminController } from './payments-admin.controller.js';
import { PaymentsAdminService } from './payments-admin.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PromoAdminController } from './promo-admin.controller.js';
import { PromoService } from './promo.service.js';
import { RenewalRemindersService } from './renewal-reminders.service.js';
import { RobokassaProvider } from './robokassa.provider.js';
import { YooKassaProvider } from './yookassa.provider.js';

@Module({})
export class PaymentsModule {
  /**
   * ADR-113 · подключены все провайдеры, чьи ключи есть на сервере; новые оплаты идут через выбранного (`PAYMENT_PROVIDER`, без него —
   * ЮKassa, затем Robokassa), а возвраты и уведомления — через того, кто принял оплату. `provider` — для тестов: один провайдер
   * или список (первый принимает новые оплаты); `null` — оплата отвечает «не подключена».
   */
  static register(config: ApiConfig, provider?: PaymentProvider | PaymentProvider[] | null): DynamicModule {
    let all: PaymentProvider[];
    let resolved: PaymentProvider | null;
    if (provider !== undefined) {
      all = provider === null ? [] : Array.isArray(provider) ? provider : [provider];
      resolved = all[0] ?? null;
    } else {
      all = [
        ...(config.yookassa ? [new YooKassaProvider(config.yookassa.shopId, config.yookassa.secretKey)] : []),
        ...(config.robokassa ? [new RobokassaProvider({ login: config.robokassa.login, password1: config.robokassa.password1, password2: config.robokassa.password2, password3: config.robokassa.password3, hash: config.robokassa.hash, test: config.robokassa.test })] : []),
      ];
      resolved = all.find((p) => p.name === config.paymentProvider) ?? all[0] ?? null;
    }
    return {
      module: PaymentsModule,
      controllers: [PaymentsController, PromoAdminController, PaymentsAdminController],
      providers: [PaymentsService, PaymentsAdminService, NpdIncomeService, PromoService, BillingService, RenewalRemindersService, { provide: API_CONFIG, useValue: config }, { provide: PAYMENT_PROVIDER, useValue: resolved }, { provide: PAYMENT_PROVIDERS, useValue: all }],
    };
  }
}
