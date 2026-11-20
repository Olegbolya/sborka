import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { RequestUser } from '../auth/session.service.js';
import { SupportService } from './support.service.js';

/** AD-13 · вопрос в поддержку со страницы «Помощь» — только для вошедших; свои вопросы и ответы на них. */
@Controller('support/questions')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @HttpCode(201)
  ask(@Body() body: { text?: unknown } | null, @CurrentUser() user: RequestUser) {
    return this.support.ask(user.id, body?.text);
  }

  @Get()
  async mine(@CurrentUser() user: RequestUser) {
    return { questions: await this.support.mine(user.id) };
  }
}

/** AD-13 · вопросы пользователей в админке: список, ответ (уходит человеку в кабинет), закрыть без ответа. */
@Roles('ADMIN')
@Controller('admin/support')
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.support.list(status);
  }

  @Post(':id/answer')
  @HttpCode(200)
  answer(@Param('id') id: string, @Body() body: { answer?: unknown } | null, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.support.answer(user.id, id, body?.answer, ip);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.support.close(user.id, id, ip);
  }
}
