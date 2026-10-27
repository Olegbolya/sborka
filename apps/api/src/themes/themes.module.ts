import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { LocalStorageService } from '../media/storage.js';
import { ThemesController } from './themes.controller.js';
import { ThemesService } from './themes.service.js';

@Module({})
export class ThemesModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ThemesModule,
      controllers: [ThemesController],
      providers: [ThemesService, { provide: LocalStorageService, useValue: new LocalStorageService(config.mediaDir) }],
      exports: [ThemesService],
    };
  }
}
