import { Controller, Get } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';

/** TPL-03 · the gallery of system templates for a signed-in creator (an empty list is an ordinary answer: the product works without them). */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list() {
    return { templates: await this.projects.listSystemTemplates() };
  }
}
