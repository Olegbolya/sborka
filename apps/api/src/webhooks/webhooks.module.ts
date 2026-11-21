import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { ResponsesService } from '../projects/responses.service.js';
import { API_CONFIG, WEBHOOK_SENDER } from '../tokens.js';
import { type WebhookSender } from './net.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

/** D-07 · webhooks of projects; global so that the end of a passage (PlayModule) hands its event over. */
@Global()
@Module({})
export class WebhooksModule {
  /** `sender` replaces the HTTP call (tests). */
  static register(config: ApiConfig, sender?: WebhookSender): DynamicModule {
    return {
      module: WebhooksModule,
      controllers: [WebhooksController],
      providers: [WebhooksService, ResponsesService, { provide: API_CONFIG, useValue: config }, ...(sender ? [{ provide: WEBHOOK_SENDER, useValue: sender }] : [])],
      exports: [WebhooksService],
    };
  }
}
