import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { COPYRIGHT_CLAIM_HOURS, DATA_REQUEST_KINDS, DATA_REQUEST_WORKING_DAYS, addWorkingDays, type DataRequestKind } from '@blokum/schema';
import { fail } from '../admin/errors.js';
import { hashIp } from '../auth/ip-hash.js';
import { type ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';

const HOUR_MS = 3_600_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const need = (value: string, min: number, max: number, code: string, what: string): string => {
  if (value.length < min || value.length > max) throw fail(422, code, `${what}: от ${min} до ${max} знаков.`);
  return value;
};

/**
 * P8.4, P8.5 · the public legal forms: a copyright holder's notice (149-ФЗ ст. 15.7 ч. 2) and a person's request about their
 * data (152-ФЗ ст. 14, 20). Both go into the registers the admin already shows, with the term counted from the moment of receipt.
 */
@Injectable()
export class LegalRequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private get perHour(): number {
    return this.config.playLimits?.reportsPerHourPerIp ?? 5;
  }

  /** The project a link points to: the last part of the path of `/s/<slug>` on any host. */
  private async projectOf(urls: string[]): Promise<string | null> {
    for (const raw of urls) {
      const m = /\/s\/([A-Za-z0-9_-]{3,80})(?:[/?#]|$)/.exec(raw);
      if (!m) continue;
      const [p] = await this.db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.slug, m[1]!), isNull(schema.projects.deletedAt)));
      if (p) return p.id;
    }
    return null;
  }

  /**
   * 149-ФЗ ст. 15.7 ч. 2: who applies (a person — name, passport details, contacts; an organisation — name, address, contacts),
   * the work, where it is placed, that the applicant holds the rights, that no permission was given, and the consent to the
   * processing of personal data. A notice without any of these is not accepted.
   */
  async copyrightClaim(body: Record<string, unknown>, ip: string, now = new Date()): Promise<{ id: string; dueAt: Date }> {
    const kind = text(body.claimantKind);
    if (kind !== 'PERSON' && kind !== 'ORG') throw fail(422, 'CLAIMANT_KIND', 'Укажите, кто обращается: человек или организация.');
    const name = need(text(body.name), 3, 300, 'CLAIMANT_NAME', kind === 'PERSON' ? 'Фамилия, имя, отчество' : 'Наименование организации');
    const document = kind === 'PERSON' ? need(text(body.document), 10, 300, 'CLAIMANT_DOCUMENT', 'Паспортные данные (серия, номер, кем и когда выдан)') : '';
    const address = kind === 'ORG' ? need(text(body.address), 10, 500, 'CLAIMANT_ADDRESS', 'Место нахождения и адрес') : '';
    const email = text(body.email);
    if (!EMAIL.test(email)) throw fail(422, 'CLAIMANT_EMAIL', 'Укажите адрес электронной почты для ответа.');
    const phone = text(body.phone);
    if (phone.length > 40) throw fail(422, 'CLAIMANT_PHONE', 'Телефон слишком длинный.');
    const representative = text(body.representative);
    if (representative.length > 500) throw fail(422, 'CLAIMANT_REPRESENTATIVE', 'Сведения о представителе слишком длинные.');
    const objectDescription = need(text(body.objectDescription), 5, 4000, 'CLAIM_OBJECT', 'Что защищается');
    const urls = (Array.isArray(body.urls) ? body.urls : []).map(text).filter((u) => u !== '');
    if (urls.length === 0) throw fail(422, 'CLAIM_URLS', 'Укажите хотя бы одну ссылку на страницу, где размещён материал.');
    if (urls.length > 20 || urls.some((u) => u.length > 500 || !/^https?:\/\/[^\s]+$/i.test(u))) throw fail(422, 'CLAIM_URLS', 'Ссылки — не больше 20, каждая начинается с http:// или https://.');
    if (body.hasRights !== true) throw fail(422, 'CLAIM_RIGHTS', 'Подтвердите, что права на материал принадлежат вам или тому, кого вы представляете.');
    if (body.noPermission !== true) throw fail(422, 'CLAIM_PERMISSION', 'Подтвердите, что разрешения на размещение материала не давали.');
    if (body.pdConsent !== true) throw fail(422, 'CLAIM_CONSENT', 'Нужно согласие на обработку персональных данных из заявления.');

    const ipHash = hashIp(ip, now, 64);
    const [recent] = await this.db
      .select({ n: count() })
      .from(schema.copyrightClaims)
      .where(and(eq(schema.copyrightClaims.ipHash, ipHash), gte(schema.copyrightClaims.receivedAt, new Date(now.getTime() - HOUR_MS))));
    if ((recent?.n ?? 0) >= this.perHour) throw fail(429, 'TOO_MANY_REQUESTS', 'Вы уже отправили несколько заявлений. Подождите немного.');

    const dueAt = new Date(now.getTime() + COPYRIGHT_CLAIM_HOURS * HOUR_MS);
    const [row] = await this.db
      .insert(schema.copyrightClaims)
      .values({
        projectId: await this.projectOf(urls),
        claimant: { kind, name, email, ...(phone ? { phone } : {}), ...(document ? { document } : {}), ...(address ? { address } : {}), ...(representative ? { representative } : {}) },
        objectDescription,
        urls,
        statement: { hasRights: true, noPermission: true, pdConsent: true, acceptedAt: now.toISOString(), source: 'FORM' },
        receivedAt: now,
        dueAt,
        ipHash,
      })
      .returning({ id: schema.copyrightClaims.id });
    return { id: row!.id, dueAt };
  }

  /** 152-ФЗ ст. 14, 20: a request to learn, delete or stop the processing; the answer is due in ten working days. */
  async dataRequest(body: Record<string, unknown>, ip: string, now = new Date()): Promise<{ id: string; dueAt: Date }> {
    const kind = text(body.kind) as DataRequestKind;
    if (!DATA_REQUEST_KINDS.some((k) => k.code === kind)) throw fail(422, 'REQUEST_KIND', 'Выберите, о чём запрос.');
    const contact = need(text(body.contact), 5, 200, 'REQUEST_CONTACT', 'Как с вами связаться (почта или телефон)');
    const details = need(text(body.details), 5, 4000, 'REQUEST_DETAILS', 'Суть запроса');
    if (body.consent !== true) throw fail(422, 'REQUEST_CONSENT', 'Чтобы мы ответили, согласитесь на обработку контакта.');
    const slug = text(body.slug);
    let projectId: string | null = null;
    if (slug !== '') {
      const [p] = await this.db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.slug, slug), isNull(schema.projects.deletedAt)));
      if (!p) throw fail(422, 'REQUEST_PROJECT', 'Сборка с таким адресом не найдена. Проверьте ссылку или оставьте поле пустым.');
      projectId = p.id;
    }
    const ipHash = hashIp(ip, now, 64);
    const [recent] = await this.db
      .select({ n: count() })
      .from(schema.dataSubjectRequests)
      .where(and(eq(schema.dataSubjectRequests.ipHash, ipHash), gte(schema.dataSubjectRequests.receivedAt, new Date(now.getTime() - HOUR_MS))));
    if ((recent?.n ?? 0) >= this.perHour) throw fail(429, 'TOO_MANY_REQUESTS', 'Вы уже отправили несколько запросов. Подождите немного.');
    const dueAt = addWorkingDays(now, DATA_REQUEST_WORKING_DAYS);
    const [row] = await this.db.insert(schema.dataSubjectRequests).values({ kind, subjectContact: contact, projectId, details, receivedAt: now, dueAt, ipHash }).returning({ id: schema.dataSubjectRequests.id });
    return { id: row!.id, dueAt };
  }
}
