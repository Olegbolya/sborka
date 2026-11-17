import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, VK_FETCH } from '../tokens.js';
import { VkAccountController, VkCallbackController } from './vk.controller.js';
import { type VkFetch, VkService } from './vk.service.js';

@Global()
@Module({})
export class VkModule {
  /** `fetchFn` replaces the real call to api.vk.com (tests). */
  static register(config: ApiConfig, fetchFn?: VkFetch): DynamicModule {
    return {
      module: VkModule,
      controllers: [VkAccountController, VkCallbackController],
      providers: [VkService, { provide: API_CONFIG, useValue: config }, ...(fetchFn ? [{ provide: VK_FETCH, useValue: fetchFn }] : [])],
      exports: [VkService],
    };
  }
}
