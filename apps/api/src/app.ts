import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type AppDeps, AppModule } from './app.module.js';
import { type ApiConfig } from './config.js';
import { NestPinoLogger } from './observability/nest-logger.js';
import { requestContext } from './observability/request-id.js';

/** Global URL prefix of the API (docs/02-ARCHITECTURE.md §6). */
export const API_PREFIX = 'api/v1';

export async function createApp(config: ApiConfig, deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config, deps), { logger: new NestPinoLogger(deps.logger) });
  app.use(requestContext(deps.logger));
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
