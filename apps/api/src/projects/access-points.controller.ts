import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { AccessPointsService } from './access-points.service.js';
import { WEB_URL } from './projects.module.js';

/** P6.2 · D-02 · Q-01…Q-07: Access points and QR. */
@Controller('projects/:projectId/access-points')
export class AccessPointsController {
  constructor(
    private readonly svc: AccessPointsService,
    @Inject(WEB_URL) private readonly webUrl: string,
  ) {}

  /** Q-01: List access points for a project. */
  @Get()
  list(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser) {
    return this.svc.list(user.id, projectId, this.webUrl);
  }

  /** Q-01: Create a new access point. */
  @Post()
  @HttpCode(200)
  create(
    @Param('projectId') projectId: string,
    @Body() body: { label?: string; kind?: 'LINK' | 'QR' },
    @CurrentUser() user: RequestUser,
  ) {
    return this.svc.create(user.id, projectId, this.webUrl, body);
  }

  /** Q-07: Toggle active state. */
  @Post(':id/active')
  @HttpCode(204)
  setActive(@Param('id') id: string, @Body() body: { active: boolean }, @CurrentUser() user: RequestUser) {
    return this.svc.setActive(user.id, id, body.active);
  }

  /** Delete access point. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.svc.delete(user.id, id);
  }

  /** Q-04/Q-05: Download QR as PNG. Query: size=1024|2048|4096. */
  @Get(':id/qr.png')
  async downloadQrPng(
    @Param('id') id: string,
    @Query('size') sizeStr: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const size = ([1024, 2048, 4096].includes(Number(sizeStr)) ? Number(sizeStr) : 1024) as 1024 | 2048 | 4096;
    const buf = await this.svc.generateQrPng(user.id, id, this.webUrl, size);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${id}-${size}.png"`);
    res.end(buf);
  }

  /** Q-04/Q-05: Download QR as SVG. */
  @Get(':id/qr.svg')
  async downloadQrSvg(@Param('id') id: string, @CurrentUser() user: RequestUser, @Res() res: Response) {
    const svg = await this.svc.generateQrSvg(user.id, id, this.webUrl);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${id}.svg"`);
    res.end(svg);
  }
}
