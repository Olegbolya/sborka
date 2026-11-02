import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { FontsService } from './fonts.service.js';
import { FONT_MAX_BYTES } from './font-processor.js';

/** TH-04 · пользовательские шрифты. */
@Controller('fonts')
export class FontsController {
  constructor(private readonly fonts: FontsService) {}

  /** TH-04 · загрузить шрифт (multipart, не более 10 МБ). */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: FONT_MAX_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: 'Файл не передан' } });
    }
    return this.fonts.upload(user.id, file.buffer);
  }

  /** TH-04 · список шрифтов пользователя. */
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.fonts.list(user.id);
  }

  /** TH-04 · удалить шрифт. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.fonts.delete(user.id, id);
  }
}
