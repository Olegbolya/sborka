import { type DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { RedisOptions } from 'bullmq';
import { MEDIA_QUEUE } from '../tokens.js';
import { type ApiConfig } from '../config.js';
import { LocalStorageService } from './storage.js';
import { MediaService } from './media.service.js';
import { MediaController } from './media.controller.js';
import { MEDIA_QUEUE_NAME, type IMediaQueue } from './media-jobs.js';

@Module({})
export class MediaModule {
  static register(config: ApiConfig, queueOverride?: IMediaQueue): DynamicModule {
    return {
      module: MediaModule,
      controllers: [MediaController],
      providers: [
        MediaService,
        { provide: LocalStorageService, useValue: new LocalStorageService(config.mediaDir) },
        queueOverride
          ? { provide: MEDIA_QUEUE, useValue: queueOverride }
          : {
              provide: MEDIA_QUEUE,
              useFactory: (): IMediaQueue => {
                const url = new URL(config.redisUrl);
                const connection: RedisOptions = {
                  host: url.hostname,
                  port: Number(url.port) || 6379,
                  db: Number(url.pathname.slice(1)) || 0,
                };
                const q = new Queue(MEDIA_QUEUE_NAME, { connection, prefix: 'bk' });
                return {
                  add: (name, data) => q.add(name, data).then(() => undefined),
                };
              },
            },
      ],
    };
  }
}
