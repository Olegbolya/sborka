import { Module } from '@nestjs/common';
import { EditorController } from './editor.controller.js';
import { SvgImportService } from './svg-import.service.js';

@Module({
  controllers: [EditorController],
  providers: [SvgImportService],
})
export class EditorModule {}
