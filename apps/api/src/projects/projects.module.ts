import { type DynamicModule, Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { AnalyticsService } from './analytics.service.js';
import { ResponsesService } from './responses.service.js';
import { AnalyticsController } from './analytics.controller.js';
import { ResponsesController } from './responses.controller.js';
import { AccessPointsService } from './access-points.service.js';
import { AccessPointsController } from './access-points.controller.js';
import { ExportService } from './export.service.js';
import { DraftsService } from './drafts.service.js';
import { DraftsController } from './drafts.controller.js';
import { SystemTemplatesService } from './system-templates.service.js';
import { TemplatesController } from './templates.controller.js';
import { ElementsController } from './elements.controller.js';
import { LocalStorageService } from '../media/storage.js';
import { AGE_RATING_REQUIRED, WEB_URL } from './projects.tokens.js';

export { WEB_URL };

@Module({})
export class ProjectsModule {
  static register(webUrl: string, ageRatingRequired = false, mediaDir = '/tmp/blokum-media'): DynamicModule {
    return {
      module: ProjectsModule,
      providers: [
        ProjectsService,
        ResponsesService,
        AnalyticsService,
        AccessPointsService,
        ExportService,
        DraftsService,
        SystemTemplatesService,
        { provide: WEB_URL, useValue: webUrl },
        { provide: LocalStorageService, useValue: new LocalStorageService(mediaDir) },
        { provide: AGE_RATING_REQUIRED, useValue: ageRatingRequired },
      ],
      controllers: [ProjectsController, TemplatesController, ElementsController, DraftsController, ResponsesController, AnalyticsController, AccessPointsController],
      exports: [ProjectsService, SystemTemplatesService],
    };
  }
}
