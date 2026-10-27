import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { PlaySessionsService } from './play-sessions.service.js';
import { PlayService } from './play.service.js';

/** The public side: no session, nothing here is allowed to reach the answer key (PL-15). */
@Public()
@Controller('play')
export class PlayController {
  constructor(
    private readonly play: PlayService,
    private readonly sessions: PlaySessionsService,
  ) {}

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
  start(@Param('projectId') projectId: string, @Body() body: { deviceToken?: unknown; source?: unknown; unlock?: unknown; age18?: unknown }, @Headers('user-agent') ua: string | undefined, @Ip() ip: string) {
    return this.play.start(projectId, body ?? {}, ua, ip);
  }

  /** PL-11 · continue a passage: where it was, the answers, and the version it began with. */
  @Get('sessions/:id')
  async resume(@Param('id') id: string) {
    const saved = await this.sessions.resume(id);
    return { ...saved, view: await this.play.openFor(saved.projectId, saved.versionId) };
  }

  /** PL-12, PL-13 · an answer (idempotent by `clientEventId`). */
  @Post('sessions/:id/answers')
  @HttpCode(200)
  answer(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.sessions.answer(id, body ?? {});
  }

  /** L-03 · feedback after an answer («сразу»). */
  @Post('sessions/:id/check')
  @HttpCode(200)
  check(@Param('id') id: string, @Body() body: { blockId?: unknown }) {
    return this.sessions.check(id, body?.blockId);
  }

  /** RN-01 · a draw that affects the result is made here before the animation. */
  @Post('sessions/:id/random')
  @HttpCode(200)
  random(@Param('id') id: string, @Body() body: { sourceId?: unknown; seq?: unknown }) {
    return this.sessions.random(id, body ?? {});
  }

  /** RN-02, AC-14, VR-04 · values counted on the device, kept as such. */
  @Post('sessions/:id/values')
  @HttpCode(200)
  values(@Param('id') id: string, @Body() body: { values?: unknown; clientTs?: unknown }) {
    return this.sessions.values(id, body ?? {});
  }

  /** L-02 · a branch that reads the answer key is decided by the server. */
  @Post('sessions/:id/branch')
  @HttpCode(200)
  branch(@Param('id') id: string, @Body() body: { screenId?: unknown }) {
    return this.sessions.branch(id, body?.screenId);
  }

  /** PL-11 · the place of the passage and the variables of scenarios. */
  @Put('sessions/:id/state')
  @HttpCode(200)
  state(@Param('id') id: string, @Body() body: unknown) {
    return this.sessions.saveState(id, body);
  }

  /** PL-15 · the end: points, right answers and the result are the server's. */
  @Post('sessions/:id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string) {
    return this.sessions.complete(id);
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
