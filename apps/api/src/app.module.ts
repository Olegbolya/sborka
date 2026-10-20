import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { type Alerts, type Logger } from '@blokum/observability';
import { type ApiConfig } from './config.js';
import { HealthController, type HealthProbes } from './health/health.controller.js';
import { AllExceptionsFilter } from './observability/exception.filter.js';
import { ALERTS, API_CONFIG, HEALTH_PROBES, LOGGER } from './tokens.js';

export interface AppDeps {
  logger: Logger;
  alerts: Alerts;
  probes: HealthProbes;
  /** Extra controllers (used by tests to exercise error handling). */
  extraControllers?: DynamicModule['controllers'];
  extraProviders?: Provider[];
}

@Module({})
export class AppModule {
  static register(config: ApiConfig, deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ...(deps.extraControllers ?? [])],
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: LOGGER, useValue: deps.logger },
        { provide: ALERTS, useValue: deps.alerts },
        { provide: HEALTH_PROBES, useValue: deps.probes },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        ...(deps.extraProviders ?? []),
      ],
    };
  }
}
