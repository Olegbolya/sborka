import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { LocalStorageService } from '../media/storage.js';
import { API_CONFIG } from '../tokens.js';
import { PlayController } from './play.controller.js';
import { PassageNoticesService } from './passage-notices.service.js';
import { ScheduleNoticesService } from './schedule-notices.service.js';
import { PlaySessionsService } from './play-sessions.service.js';
import { PlayService } from './play.service.js';

@Module({})
export class PlayModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: PlayModule,
      controllers: [PlayController],
      providers: [PlayService, PlaySessionsService, PassageNoticesService, ScheduleNoticesService, { provide: API_CONFIG, useValue: config }, { provide: LocalStorageService, useValue: new LocalStorageService(config.mediaDir) }],
      exports: [PlayService, PassageNoticesService, ScheduleNoticesService],
    };
  }
}
