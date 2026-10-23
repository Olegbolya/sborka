import { type DynamicModule, Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ResponsesService } from './responses.service.js';
import { ResponsesController } from './responses.controller.js';
import { AccessPointsService } from './access-points.service.js';
import { AccessPointsController } from './access-points.controller.js';
import { ExportService } from './export.service.js';

export const WEB_URL = Symbol('WEB_URL');

@Module({})
export class ProjectsModule {
  static register(webUrl: string): DynamicModule {
    return {
      module: ProjectsModule,
      providers: [
        ProjectsService,
        ResponsesService,
        AccessPointsService,
        ExportService,
        { provide: WEB_URL, useValue: webUrl },
      ],
      controllers: [ProjectsController, ResponsesController, AccessPointsController],
      exports: [ProjectsService],
    };
  }
}
