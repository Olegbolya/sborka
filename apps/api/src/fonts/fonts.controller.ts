import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Body,
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
import { FONT_MAX_BYTES, isFontLicense } from './font-processor.js';

/** TH-04 · пользовательские шрифты. */
@Controller('fonts')
export class FontsController {
  constructor(private readonly fonts: FontsService) {}

  /** TH-04 · загрузить шрифт (multipart: file и license — OFL | PURCHASED_WEB | OWN_WORK; не более 10 МБ). */
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
    @Body('license') license?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: 'Файл не передан' } });
    }
    if (!isFontLicense(license)) {
      throw new BadRequestException({
        error: { code: 'FONT_LICENSE_REQUIRED', message: 'Укажите, на каком основании вы используете шрифт: свободная лицензия (OFL), купленная веб-лицензия или ваша собственная работа' },
      });
    }
    return this.fonts.upload(user.id, file.buffer, license);
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
