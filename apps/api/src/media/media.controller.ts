import type { IncomingMessage } from 'node:http';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { MediaService } from './media.service.js';

const MAX_DIRECT_BYTES = 30 * 1024 * 1024; // 30 МБ — largest FREE limit (video)

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** P4.1/B-02…B-07/TS-01: Direct multipart upload (≤ 30 МБ). */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DIRECT_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException({ error: { code: 'FILE_MISSING', message: 'Файл не передан' } });
    return this.media.uploadBuffer(user.id, file.buffer);
  }

  /** P4.1: Start a chunked upload session. Body: { totalBytes }. */
  @Post('sessions')
  async startSession(
    @CurrentUser() user: RequestUser,
    @Body() body: Record<string, unknown>,
  ) {
    const totalBytes = Number(body?.['totalBytes'] ?? 0);
    if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
      throw new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'totalBytes должен быть положительным числом' } });
    }
    const sessionId = await this.media.startSession(user.id, totalBytes);
    return { sessionId };
  }

  /** P4.1: Upload a chunk. Body is raw bytes (application/octet-stream). Reads from the stream directly
   * because NestJS body parsers skip octet-stream and leave the stream unconsumed. */
  @Put('sessions/:id')
  async appendChunk(
    @CurrentUser() user: RequestUser,
    @Param('id') sessionId: string,
    @Req() req: IncomingMessage,
  ) {
    const chunk = await new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => resolve(Buffer.concat(parts)));
      req.on('error', reject);
    });
    if (!chunk || chunk.length === 0) {
      throw new BadRequestException({ error: { code: 'CHUNK_EMPTY', message: 'Тело запроса пусто' } });
    }
    return this.media.appendChunk(user.id, sessionId, chunk);
  }

  /** P4.1: Complete a chunked upload — validate, create record, enqueue processing. */
  @Post('sessions/:id/complete')
  async completeSession(
    @CurrentUser() user: RequestUser,
    @Param('id') sessionId: string,
  ) {
    return this.media.completeSession(user.id, sessionId);
  }

  /** P4.4/D-08: List user's media files with cursor pagination. */
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('kind') kind?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.media.list(user.id, { kind, cursor, limit: limit ? Number(limit) : undefined });
  }

  /** The owner's original file (the editor shows it in fills and previews); other people get a 404. */
  @Get(':id/file')
  async file(@CurrentUser() user: RequestUser, @Param('id') mediaId: string, @Res() res: Response): Promise<void> {
    const { path, mime } = await this.media.fileOf(user.id, mediaId);
    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        path,
        {
          // Ranges (video seeking) are handled by sendFile; the type is the one found by the signature check, never the upload's.
          headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' },
          dotfiles: 'allow',
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /** P4.4/D-08: Delete media. ?confirm=true skips the usage check. */
  @Delete(':id')
  async deleteMedia(
    @CurrentUser() user: RequestUser,
    @Param('id') mediaId: string,
    @Query('confirm') confirm?: string,
  ) {
    return this.media.delete(user.id, mediaId, confirm === 'true');
  }
}
