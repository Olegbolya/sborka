import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, TELEGRAM_FETCH } from '../tokens.js';
import { TelegramAccountController, TelegramWebhookController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

@Global()
@Module({})
export class TelegramModule {
  /** `fetchFn` replaces the real call to api.telegram.org (tests). */
  static register(config: ApiConfig, fetchFn?: FetchLike): DynamicModule {
    return {
      module: TelegramModule,
      controllers: [TelegramAccountController, TelegramWebhookController],
      providers: [TelegramService, { provide: API_CONFIG, useValue: config }, ...(fetchFn ? [{ provide: TELEGRAM_FETCH, useValue: fetchFn }] : [])],
      exports: [TelegramService],
    };
  }
}
