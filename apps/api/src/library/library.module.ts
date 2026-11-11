import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiConfig } from '../config.js';
import { LocalStorageService } from '../media/storage.js';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';

@Module({})
export class LibraryModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: LibraryModule,
      controllers: [LibraryController],
      providers: [LibraryService, { provide: LocalStorageService, useValue: new LocalStorageService(config.mediaDir) }],
      exports: [LibraryService],
    };
  }
}
