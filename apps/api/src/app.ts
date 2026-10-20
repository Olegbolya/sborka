import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { type ApiConfig } from './config.js';

/** Global URL prefix of the API (docs/02-ARCHITECTURE.md §6). */
export const API_PREFIX = 'api/v1';

export async function createApp(config: ApiConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), { logger: ['error', 'warn'] });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
