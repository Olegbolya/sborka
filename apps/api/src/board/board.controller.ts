import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { BoardService } from './board.service.js';

/** D-17 · the public board: no sign-in, no answers of anyone in it, only the standings. */
@Controller('board')
export class PublicBoardController {
  constructor(private readonly board: BoardService) {}

  @Public()
  @Get(':code')
  async get(@Param('code') code: string) {
    const board = await this.board.publicBoard(code);
    if (!board) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Такого табло нет или оно выключено.' } });
    return board;
  }
}

/** D-13, D-19 · the creator's side of the board. */
@Controller('projects/:projectId/board')
export class CreatorBoardController {
  constructor(private readonly board: BoardService) {}

  @Get()
  get(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser) {
    return this.board.get(user.id, projectId);
  }

  @Put()
  save(@Param('projectId') projectId: string, @Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.board.save(user.id, projectId, body);
  }

  @Get('rows')
  rows(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser) {
    return this.board.rowsForCreator(user.id, projectId);
  }

  @Get('qr.svg')
  async qrSvg(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser, @Res() res: Response) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(await this.board.qr(user.id, projectId, 'svg'));
  }

  @Get('qr.png')
  async qrPng(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser, @Res() res: Response) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="tablo-${projectId}.png"`);
    res.end(await this.board.qr(user.id, projectId, 'png'));
  }

  @Post('freeze')
  @HttpCode(204)
  async freeze(@Param('projectId') projectId: string, @Body() body: { frozen?: unknown } | null, @CurrentUser() user: RequestUser) {
    await this.board.freeze(user.id, projectId, body?.frozen);
  }

  @Post('reset')
  @HttpCode(204)
  async reset(@Param('projectId') projectId: string, @CurrentUser() user: RequestUser) {
    await this.board.reset(user.id, projectId);
  }

  @Post('hide')
  @HttpCode(204)
  async hide(@Param('projectId') projectId: string, @Body() body: { key?: unknown; hidden?: unknown } | null, @CurrentUser() user: RequestUser) {
    await this.board.hide(user.id, projectId, body?.key, body?.hidden);
  }
}
