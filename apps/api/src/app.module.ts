import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from './config.js';
import { HealthController } from './health/health.controller.js';
import { API_CONFIG } from './tokens.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: API_CONFIG, useValue: config }],
    };
  }
}
