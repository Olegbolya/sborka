import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { API_CONFIG } from '../tokens.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({})
export class ReportsModule {
  static register(config: ApiConfig): DynamicModule {
    return { module: ReportsModule, controllers: [ReportsController], providers: [ReportsService, { provide: API_CONFIG, useValue: config }] };
  }
}
