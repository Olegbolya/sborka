import { Controller, HttpCode, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators.js';
import { SvgImportService } from './svg-import.service.js';

@Controller('editor')
export class EditorController {
  constructor(private readonly svgImport: SvgImportService) {}

  /**
   * TS-27 · E-21 · Import SVG contours: accept an SVG file and return normalised path strings.
   * Only geometric elements (path, rect, circle, ellipse, line, polyline, polygon) are extracted;
   * scripts, foreignObject, use, style, image and all event handlers are silently ignored.
   */
  @Post('svg-import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 1_048_576 } }))
  importSvg(
    @CurrentUser() _user: { id: string },
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException({ error: { code: 'FILE_MISSING', message: 'Файл не прикреплён' } });
    const paths = this.svgImport.import(file.buffer);
    return { paths };
  }
}
