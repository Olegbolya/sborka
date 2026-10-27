import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { type ReportInput, ReportsService } from './reports.service.js';

/** TS-11 · the public complaint form («Пожаловаться» in the player footer). */
@Public()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: ReportInput, @Ip() ip: string) {
    await this.reports.create(body ?? {}, ip);
    return { ok: true };
  }
}
