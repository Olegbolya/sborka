import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { LocalStorageService } from '../media/storage.js';
import { FontsController } from './fonts.controller.js';
import { FontsService } from './fonts.service.js';

@Module({})
export class FontsModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: FontsModule,
      controllers: [FontsController],
      providers: [
        FontsService,
        { provide: LocalStorageService, useValue: new LocalStorageService(config.mediaDir) },
      ],
      exports: [FontsService],
    };
  }
}
