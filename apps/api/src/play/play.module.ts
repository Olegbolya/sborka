import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { LocalStorageService } from '../media/storage.js';
import { PlayController } from './play.controller.js';
import { PlayService } from './play.service.js';

@Module({})
export class PlayModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: PlayModule,
      controllers: [PlayController],
      providers: [PlayService, { provide: LocalStorageService, useValue: new LocalStorageService(config.mediaDir) }],
      exports: [PlayService],
    };
  }
}
