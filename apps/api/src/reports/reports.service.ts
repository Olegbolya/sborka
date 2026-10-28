import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ModerationService } from '../admin/moderation.service.js';
import { createHash } from 'node:crypto';
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { REPORT_SLA_HOURS, findReportCategory } from '@blokum/schema';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';

const fail = (status: number, code: string, message: string): HttpException => new HttpException({ error: { code, message } }, status);

/** From one address: how many complaints an hour (the form is public and has no captcha until the owner gives the keys); `REPORTS_PER_HOUR_PER_IP`. */
const HOUR_MS = 3_600_000;

export interface ReportInput {
  slug?: unknown;
  category?: unknown;
  text?: unknown;
  contact?: unknown;
  consent?: unknown;
}

/** TS-11, PL-16 · a complaint from the player: it keeps the published version as it was seen (§4.1) and gets its priority and term (§4.2). */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() private readonly moderation?: ModerationService,
  ) {}

  async create(body: ReportInput, ip: string, now = new Date()): Promise<{ id: string; priority: string }> {
    const category = typeof body.category === 'string' ? findReportCategory(body.category) : undefined;
    if (!category) throw fail(422, 'REPORT_CATEGORY', 'Выберите, что не так.');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 5 || text.length > 4000) throw fail(422, 'REPORT_TEXT', 'Опишите, что не так, — от 5 до 4000 знаков.');
    const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
    if (contact.length > 200) throw fail(422, 'REPORT_CONTACT', 'Контакт слишком длинный.');
    if (contact !== '' && body.consent !== true) throw fail(422, 'REPORT_CONSENT', 'Чтобы мы ответили, согласитесь на обработку контакта.');
    if (typeof body.slug !== 'string' || body.slug === '') throw fail(422, 'REPORT_PROJECT', 'Не указана сборка.');

    const [project] = await this.db
      .select({ id: schema.projects.id, versionId: schema.projects.publishedVersionId })
      .from(schema.projects)
      .where(and(eq(schema.projects.slug, body.slug), isNull(schema.projects.deletedAt)));
    if (!project) throw fail(404, 'UNAVAILABLE', 'Недоступно');

    const ipHash = createHash('sha256').update(`ip:${now.toISOString().slice(0, 10)}:${ip}`).digest('hex');
    const [recent] = await this.db
      .select({ n: count() })
      .from(schema.reports)
      .where(and(eq(schema.reports.reporterIpHash, ipHash), gte(schema.reports.createdAt, new Date(now.getTime() - HOUR_MS))));
    if ((recent?.n ?? 0) >= (this.config.playLimits?.reportsPerHourPerIp ?? 5)) throw fail(429, 'TOO_MANY_REQUESTS', 'Вы уже отправили несколько жалоб. Подождите немного.');

    const [row] = await this.db
      .insert(schema.reports)
      .values({
        projectId: project.id,
        snapshotVersionId: project.versionId,
        category: category.code,
        text,
        reporterContact: contact === '' ? null : contact,
        reporterIpHash: ipHash,
        priority: category.priority,
        slaDueAt: new Date(now.getTime() + REPORT_SLA_HOURS[category.priority] * HOUR_MS),
      })
      .returning({ id: schema.reports.id });
    // §4.2: a heavy complaint closes the project at once and tells the owner of the service.
    await this.moderation?.onReport(row!.id, now);
    return { id: row!.id, priority: category.priority };
  }
}
