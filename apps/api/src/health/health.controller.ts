import { Controller, Get, Inject } from '@nestjs/common';
import { API_CONFIG } from '../tokens.js';
import type { ApiConfig } from '../config.js';

export interface HealthResponse {
  status: 'ok';
  service: 'blokum-api';
  version: string;
  uptimeSeconds: number;
  time: string;
}

@Controller('health')
export class HealthController {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'blokum-api',
      version: this.config.version,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}
