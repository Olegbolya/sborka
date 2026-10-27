import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { PlayService } from './play.service.js';

/** The public side: no session, nothing here is allowed to reach the answer key (PL-15). */
@Public()
@Controller('play')
export class PlayController {
  constructor(private readonly play: PlayService) {}

  @Get('scan/:code')
  scan(@Param('code') code: string) {
    return this.play.scan(code);
  }

  /** The unlock proof and the age confirmation travel in headers: the browser keeps them for the tab (PL-08, PL-09). */
  @Get(':slug')
  view(@Param('slug') slug: string, @Headers('x-play-unlock') unlock: string | undefined, @Headers('x-play-age') age: string | undefined) {
    return this.play.view(slug, { unlock, ageConfirmed: age === '1' });
  }

  /** PL-08, PL-09 · «Войти»: password and/or «мне есть 18». */
  @Post(':slug/enter')
  @HttpCode(200)
  enter(@Param('slug') slug: string, @Body() body: { password?: unknown; age18?: unknown }, @Ip() ip: string) {
    return this.play.enter(slug, body ?? {}, ip);
  }

  /** PL-11 · the start of a passage (docs/02-ARCHITECTURE.md §6: `POST /play/:projectId/sessions`). */
  @Post(':projectId/sessions')
  @HttpCode(201)
  start(@Param('projectId') projectId: string, @Body() body: { deviceToken?: unknown; source?: unknown; unlock?: unknown; age18?: unknown }, @Headers('user-agent') ua: string | undefined) {
    return this.play.start(projectId, body ?? {}, ua);
  }

  @Get(':slug/media/:mediaId')
  async media(@Param('slug') slug: string, @Param('mediaId') mediaId: string, @Res() res: Response): Promise<void> {
    const { path, mime } = await this.play.mediaFile(slug, mediaId);
    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        path,
        { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }, dotfiles: 'allow' },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
}
