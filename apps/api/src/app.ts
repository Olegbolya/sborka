import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type AppDeps, AppModule } from './app.module.js';
import { type ApiConfig } from './config.js';
import { NestPinoLogger } from './observability/nest-logger.js';
import { requestContext } from './observability/request-id.js';

/** Global URL prefix of the API (docs/02-ARCHITECTURE.md §6). */
export const API_PREFIX = 'api/v1';

export async function createApp(config: ApiConfig, deps: AppDeps): Promise<INestApplication> {
  // A document may be up to 3 MB (DOCUMENT_LIMITS.bytes); the stock limit of the body parser is 100 kB.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, deps), { logger: new NestPinoLogger(deps.logger), abortOnError: false, bodyParser: false });
  app.useBodyParser('json', { limit: '4mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  app.use(requestContext(deps.logger));
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
