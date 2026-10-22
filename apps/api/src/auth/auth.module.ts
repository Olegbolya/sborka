import { Module } from '@nestjs/common';
import { SessionService } from './session.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  providers: [SessionService],
  controllers: [AuthController],
  exports: [SessionService],
})
export class AuthModule {}
