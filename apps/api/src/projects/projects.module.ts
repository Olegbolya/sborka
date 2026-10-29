import { type DynamicModule, Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ResponsesService } from './responses.service.js';
import { ResponsesController } from './responses.controller.js';
import { AccessPointsService } from './access-points.service.js';
import { AccessPointsController } from './access-points.controller.js';
import { ExportService } from './export.service.js';
import { DraftsService } from './drafts.service.js';
import { DraftsController } from './drafts.controller.js';
import { TemplatesController } from './templates.controller.js';
import { WEB_URL } from './projects.tokens.js';

export { WEB_URL };

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
        DraftsService,
        { provide: WEB_URL, useValue: webUrl },
      ],
      controllers: [ProjectsController, TemplatesController, DraftsController, ResponsesController, AccessPointsController],
      exports: [ProjectsService],
    };
  }
}
