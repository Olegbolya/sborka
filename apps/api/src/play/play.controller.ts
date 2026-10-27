import { Controller, Get, Param, Res } from '@nestjs/common';
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

  @Get(':slug')
  view(@Param('slug') slug: string) {
    return this.play.view(slug);
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
