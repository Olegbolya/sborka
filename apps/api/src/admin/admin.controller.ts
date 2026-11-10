import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Ip, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { type RequestUser } from '../auth/session.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { LegalLogsService } from './legal-logs.service.js';
import { LibraryAdminService } from './library-admin.service.js';
import { type ActInput, ModerationService } from './moderation.service.js';
import { RetentionService } from './retention.service.js';
import { SystemContentService } from './system-content.service.js';
import { SystemService } from './system.service.js';

type Body = Record<string, unknown>;

/**
 * AD-02, AD-03, AD-04, AD-07, AD-09, AD-11 · the admin: the whole controller is for moderators and administrators (AD-01);
 * what only an administrator may do is marked on the route.
 */
@Roles('MODERATOR', 'ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly users: AdminUsersService,
    private readonly legal: LegalLogsService,
    private readonly flags: FeatureFlagsService,
    private readonly system: SystemService,
    private readonly content: SystemContentService,
    private readonly libAdmin: LibraryAdminService,
    private readonly retention: RetentionService,
  ) {}

  // ── Moderation ─────────────────────────────────────────────────────────────

  @Get('work')
  async work() {
    return { ...(await this.moderation.counts()), legalOverdue: await this.legal.overdueCount() };
  }

  @Get('queue')
  queue(@Query('status') status?: string, @Query('priority') priority?: string) {
    return this.moderation.queue({ ...(status ? { status } : {}), ...(priority ? { priority } : {}) });
  }

  @Get('cases/:id')
  caseDetail(@Param('id') id: string) {
    return this.moderation.caseDetail(id);
  }

  @Post('cases/:id/take')
  @HttpCode(204)
  async take(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.moderation.take(id, user, ip);
  }

  @Post('cases/:id/dismiss')
  @HttpCode(204)
  async dismiss(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.moderation.dismiss(id, user, body?.note, ip);
  }

  @Post('actions')
  @HttpCode(201)
  act(@Body() body: ActInput, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.moderation.act(user, body ?? ({} as ActInput), ip);
  }

  @Get('appeals')
  appeals(@Query('status') status?: string) {
    return this.moderation.appeals(status);
  }

  @Post('appeals/:id/decide')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.moderation.decideAppeal(user, id, body?.decision, body?.note, ip);
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  searchUsers(@Query('q') q?: string) {
    return this.users.search(q);
  }

  @Get('users/:id')
  profile(@Param('id') id: string) {
    return this.users.profile(id);
  }

  // ── Notices and requests ───────────────────────────────────────────────────

  @Get('copyright-claims')
  claims() {
    return this.legal.claims();
  }

  @Post('copyright-claims')
  @HttpCode(201)
  registerClaim(@Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.legal.registerClaim(user, body ?? {}, ip);
  }

  @Post('copyright-claims/:id/clarify')
  @HttpCode(204)
  async clarify(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.legal.clarify(user, id, ip);
  }

  @Post('copyright-claims/:id/resolve')
  @HttpCode(204)
  async resolveClaim(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.legal.resolveClaim(user, id, body ?? {}, ip);
  }

  @Get('authority-requests')
  authority() {
    return this.legal.authority();
  }

  @Post('authority-requests')
  @HttpCode(201)
  registerAuthority(@Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.legal.registerAuthority(user, body ?? {}, ip);
  }

  @Post('authority-requests/:id/actions')
  @HttpCode(204)
  async authorityAction(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.legal.addAuthorityAction(user, id, body?.action, ip);
  }

  @Post('authority-requests/:id/close')
  @HttpCode(204)
  async closeAuthority(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.legal.closeAuthority(user, id, ip);
  }

  @Get('data-requests')
  dataRequests() {
    return this.legal.dataRequests();
  }

  @Post('data-requests/:id/extend')
  @HttpCode(204)
  async extendDataRequest(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.legal.extendDataRequest(user, id, body?.reason, ip);
  }

  @Post('data-requests/:id/close')
  @HttpCode(204)
  async closeDataRequest(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.legal.closeDataRequest(user, id, body?.resolution, ip);
  }

  // ── Only administrators ────────────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('system')
  state() {
    return this.system.state();
  }

  @Roles('ADMIN')
  @Get('audit')
  audit(@Query() query: Record<string, string>) {
    return this.system.audit(query);
  }

  /** P8.8 · the journal of destruction of data (confirmation of destruction). */
  @Roles('ADMIN')
  @Get('destruction-log')
  destructionLog() {
    return this.retention.journal();
  }

  /** P8.9 · the journal of the organizer of dissemination (empty while the mode is off). */
  @Roles('ADMIN')
  @Get('comms-meta')
  commsMeta(@Query('projectId') projectId?: string, @Query('recipientId') recipientId?: string) {
    return this.retention.commsMeta({ ...(projectId ? { projectId } : {}), ...(recipientId ? { recipientId } : {}) });
  }

  @Roles('ADMIN')
  @Get('flags')
  listFlags() {
    return this.flags.list();
  }

  @Roles('ADMIN')
  @Put('flags/:key')
  setFlag(@Param('key') key: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.flags.set(key, body?.enabled === true, typeof body?.note === 'string' ? body.note : '', user.id, ip);
  }

  @Roles('ADMIN')
  @Get('templates')
  templates() {
    return this.content.templates();
  }

  @Roles('ADMIN')
  @Post('templates')
  @HttpCode(201)
  publishTemplate(@Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.content.publishTemplate(user, body ?? {}, ip);
  }

  @Roles('ADMIN')
  @Patch('templates/:id')
  @HttpCode(204)
  async updateTemplate(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.content.updateTemplate(user, id, body ?? {}, ip);
  }

  @Roles('ADMIN')
  @Delete('templates/:id')
  @HttpCode(204)
  async removeTemplate(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.content.removeTemplate(user, id, ip);
  }

  @Roles('ADMIN')
  @Get('themes')
  themes() {
    return this.content.themes();
  }

  @Roles('ADMIN')
  @Post('themes')
  @HttpCode(201)
  publishTheme(@Body() body: Body, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    return this.content.publishTheme(user, body ?? {}, ip);
  }

  @Roles('ADMIN')
  @Delete('themes/:id')
  @HttpCode(204)
  async removeTheme(@Param('id') id: string, @CurrentUser() user: RequestUser, @Ip() ip: string) {
    await this.content.removeTheme(user, id, ip);
  }

  // ── Library (AD-10) ────────────────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('library/collections')
  libraryCollections() {
    return this.libAdmin.listCollections();
  }

  @Roles('ADMIN')
  @Post('library/collections')
  @HttpCode(201)
  createLibraryCollection(@Body() body: Body, @CurrentUser() user: RequestUser) {
    return this.libAdmin.createCollection(body ?? {}, user.id);
  }

  @Roles('ADMIN')
  @Delete('library/collections/:id')
  @HttpCode(204)
  async deleteLibraryCollection(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.libAdmin.deleteCollection(id, user.id);
  }

  @Roles('ADMIN')
  @Post('library/items')
  @HttpCode(201)
  createLibraryItem(@Body() body: Body, @CurrentUser() user: RequestUser) {
    return this.libAdmin.addItem(body ?? {}, user.id);
  }

  @Roles('ADMIN')
  @Post('library/import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  importLibraryZip(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: RequestUser) {
    if (!file?.buffer?.length) throw new BadRequestException({ error: { code: 'FILE_MISSING', message: 'ZIP-файл не передан' } });
    return this.libAdmin.importZip(file.buffer, user.id);
  }

  @Roles('ADMIN')
  @Delete('library/items/:id')
  @HttpCode(204)
  async withdrawLibraryItem(@Param('id') id: string, @Body() body: Body, @CurrentUser() user: RequestUser) {
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    await this.libAdmin.withdrawItem(id, reason, user.id);
  }

  @Roles('ADMIN')
  @Get('library/licenses')
  libraryLicenseManifest() {
    return this.libAdmin.licenseManifest();
  }
}
