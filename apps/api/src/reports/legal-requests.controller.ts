import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { LegalRequestsService } from './legal-requests.service.js';

/** P8.4, P8.5 · the public legal forms: `/legal/copyright` and `/legal/data-request`. */
@Public()
@Controller('legal/requests')
export class LegalRequestsController {
  constructor(private readonly requests: LegalRequestsService) {}

  @Post('copyright')
  @HttpCode(201)
  async copyright(@Body() body: Record<string, unknown>, @Ip() ip: string) {
    const { id, dueAt } = await this.requests.copyrightClaim(body ?? {}, ip);
    return { id, dueAt };
  }

  @Post('data')
  @HttpCode(201)
  async data(@Body() body: Record<string, unknown>, @Ip() ip: string) {
    const { id, dueAt } = await this.requests.dataRequest(body ?? {}, ip);
    return { id, dueAt };
  }
}
