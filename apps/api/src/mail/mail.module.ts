import { Module } from '@nestjs/common';
import { MailTemplatesService } from './mail-templates.service.js';

@Module({
  providers: [MailTemplatesService],
  exports: [MailTemplatesService],
})
export class MailModule {}
