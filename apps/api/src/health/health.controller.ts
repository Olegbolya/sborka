import { Controller, Get, Inject } from '@nestjs/common';
import { API_CONFIG, HEALTH_PROBES } from '../tokens.js';
import type { ApiConfig } from '../config.js';
import { Public } from '../auth/decorators.js';

/** A dependency check; never throws — returns false (or a percentage for disk) on failure. */
export interface HealthProbes {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
  diskUsedPct(): Promise<number | null>;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'blokum-api';
  version: string;
  uptimeSeconds: number;
  time: string;
  checks: { database: 'ok' | 'fail'; redis: 'ok' | 'fail'; diskUsedPct: number | null };
}

/**
 * Liveness + dependency status. Always HTTP 200 while the process works (deploy health check),
 * `status: degraded` when the database, Redis or disk (> 90 %) needs attention.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(HEALTH_PROBES) private readonly probes: HealthProbes,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    const [db, redis, disk] = await Promise.all([
      this.probes.database().catch(() => false),
      this.probes.redis().catch(() => false),
      this.probes.diskUsedPct().catch(() => null),
    ]);
    const healthy = db && redis && (disk === null || disk <= 90);
    return {
      status: healthy ? 'ok' : 'degraded',
      service: 'blokum-api',
      version: this.config.version,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
      checks: { database: db ? 'ok' : 'fail', redis: redis ? 'ok' : 'fail', diskUsedPct: disk },
    };
  }
}
