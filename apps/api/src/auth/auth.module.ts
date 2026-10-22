import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SessionService } from './session.service.js';

@Module({
  providers: [SessionService],
  controllers: [AuthController],
  exports: [SessionService],
})
export class AuthModule {}
