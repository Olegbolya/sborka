import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import AdmZip from 'adm-zip';
import { type Db, schema } from '@blokum/db';
import { createId } from '@blokum/schema';
import { DB } from '../tokens.js';
import { AuditLogService } from '../auth/audit-log.service.js';
import { NotificationsService } from './notifications.service.js';
import { fail } from './errors.js';

const LICENSES = ['OWN', 'OFL', 'CC0', 'MIT', 'APACHE', 'CC_BY', 'LICENSED'] as const;
const KINDS = ['STICKERS', 'REACTIONS', 'BACKGROUNDS', 'SOUNDS', 'FONTS', 'ANIMATIONS'] as const;

function text(v: unknown, what: string, max = 500): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw fail(422, 'REQUIRED', `${what}: обязательное поле`);
  if (t.length > max) throw fail(422, 'TOO_LONG', `${what}: не более ${max} символов`);
  return t;
}

function validLicense(v: unknown): typeof LICENSES[number] {
  if (LICENSES.includes(v as typeof LICENSES[number])) return v as typeof LICENSES[number];
  throw fail(422, 'INVALID_LICENSE', `Лицензия: допустимы ${LICENSES.join(', ')}`);
}

function validKind(v: unknown): typeof KINDS[number] {
  if (KINDS.includes(v as typeof KINDS[number])) return v as typeof KINDS[number];
  throw fail(422, 'INVALID_KIND', `Вид: допустимы ${KINDS.join(', ')}`);
}

/** AD-10 · управление библиотекой платформы: коллекции, единицы, массовый импорт, снятие (LB-04). */
@Injectable()
export class LibraryAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditLogService,
    private readonly notify: NotificationsService,
  ) {}

  // ── Collections ──────────────────────────────────────────────────────────

  async createCollection(body: unknown, adminId: string) {
    const b = body as Record<string, unknown>;
    const kind = validKind(b.kind);
    const title = text(b.title, 'Название', 100);
    const sort = typeof b.sort === 'number' ? b.sort : 0;
    const id = createId();
    await this.db.insert(schema.libraryCollections).values({ id, kind, title, sort, active: true });
    await this.audit.log({ action: 'LIBRARY_COLLECTION_CREATE', actorId: adminId, targetType: 'library_collection', targetId: id, meta: { kind, title } });
    const [row] = await this.db.select().from(schema.libraryCollections).where(eq(schema.libraryCollections.id, id));
    return row!;
  }

  async deleteCollection(id: string, adminId: string) {
    const [col] = await this.db.select({ id: schema.libraryCollections.id }).from(schema.libraryCollections).where(eq(schema.libraryCollections.id, id));
    if (!col) throw fail(404, 'NOT_FOUND', 'Коллекция не найдена');
    await this.db.delete(schema.libraryItems).where(eq(schema.libraryItems.collectionId, id));
    await this.db.delete(schema.libraryCollections).where(eq(schema.libraryCollections.id, id));
    await this.audit.log({ action: 'LIBRARY_COLLECTION_DELETE', actorId: adminId, targetType: 'library_collection', targetId: id });
  }

  async listCollections() {
    return this.db
      .select()
      .from(schema.libraryCollections)
      .orderBy(asc(schema.libraryCollections.sort), asc(schema.libraryCollections.title));
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  async addItem(body: unknown, adminId: string) {
    const b = body as Record<string, unknown>;
    const collectionId = text(b.collectionId, 'collectionId', 50);
    const [col] = await this.db.select({ id: schema.libraryCollections.id }).from(schema.libraryCollections).where(eq(schema.libraryCollections.id, collectionId));
    if (!col) throw fail(404, 'NOT_FOUND', 'Коллекция не найдена');

    // Exactly one asset: mediaId xor fontId (LB-01)
    const mediaId = typeof b.mediaId === 'string' && b.mediaId ? b.mediaId : null;
    const fontId = typeof b.fontId === 'string' && b.fontId ? b.fontId : null;
    if ((mediaId !== null) === (fontId !== null)) {
      throw fail(422, 'ONE_ASSET_REQUIRED', 'Требуется ровно один ассет: mediaId или fontId');
    }
    if (mediaId) {
      const [m] = await this.db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, mediaId));
      if (!m) throw fail(404, 'MEDIA_NOT_FOUND', 'Медиафайл не найден');
    }
    if (fontId) {
      const [f] = await this.db.select({ id: schema.fonts.id }).from(schema.fonts).where(eq(schema.fonts.id, fontId));
      if (!f) throw fail(404, 'FONT_NOT_FOUND', 'Шрифт не найден');
    }

    const title = text(b.title, 'Название', 200);
    const license = validLicense(b.license);
    const author = text(b.author, 'Автор', 200);
    const source = text(b.source, 'Источник', 500);
    const attribution = typeof b.attribution === 'string' ? b.attribution.trim() : null;
    const tags = Array.isArray(b.tags) ? (b.tags as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean) : [];

    const id = createId();
    await this.db.insert(schema.libraryItems).values({
      id,
      collectionId,
      mediaId,
      fontId,
      title,
      tags,
      license,
      author,
      source,
      attribution: attribution || null,
      rightsConfirmedById: adminId,
      rightsConfirmedAt: new Date(),
      active: true,
    });
    await this.audit.log({ action: 'LIBRARY_ITEM_ADD', actorId: adminId, targetType: 'library_item', targetId: id, meta: { collectionId, title, license } });
    const [row] = await this.db.select().from(schema.libraryItems).where(eq(schema.libraryItems.id, id));
    return row!;
  }

  /**
   * AD-10, LB-05 · массовый импорт: ZIP + CSV-описание.
   * CSV-формат (первая строка — заголовки):
   * filename,collection_id,title,license,author,source,attribution,tags
   */
  async importZip(zipBuffer: Buffer, adminId: string): Promise<{ imported: number; errors: string[] }> {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Find CSV manifest
    const csvEntry = entries.find((e) => e.name.toLowerCase().endsWith('.csv') && !e.name.startsWith('__MACOSX'));
    if (!csvEntry) throw fail(422, 'CSV_MISSING', 'В ZIP нет CSV-манифеста (filename,collection_id,title,license,author,source,attribution,tags)');

    const csvText = csvEntry.getData().toString('utf8');
    const rows = parseCsv(csvText);
    if (rows.length === 0) throw fail(422, 'CSV_EMPTY', 'CSV-манифест пуст');

    const headers = rows[0]!;
    const col = (name: string) => headers.indexOf(name);
    const iFile = col('filename');
    const iColl = col('collection_id');
    const iTitle = col('title');
    const iLicense = col('license');
    const iAuthor = col('author');
    const iSource = col('source');
    const iAttr = col('attribution');
    const iTags = col('tags');
    if ([iFile, iColl, iTitle, iLicense, iAuthor, iSource].some((i) => i === -1)) {
      throw fail(422, 'CSV_HEADERS', 'CSV: обязательные колонки: filename, collection_id, title, license, author, source');
    }

    const fileMap = new Map<string, Buffer>();
    for (const e of entries) {
      if (!e.isDirectory && !e.name.toLowerCase().endsWith('.csv')) {
        fileMap.set(e.name, e.getData());
      }
    }

    let imported = 0;
    const errors: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      try {
        const filename = (r[iFile] ?? '').trim();
        const collectionId = (r[iColl] ?? '').trim();
        const title = (r[iTitle] ?? '').trim();
        const license = (r[iLicense] ?? '').trim();
        const author = (r[iAuthor] ?? '').trim();
        const source = (r[iSource] ?? '').trim();
        const attribution = iAttr >= 0 ? (r[iAttr] ?? '').trim() : '';
        const tagsRaw = iTags >= 0 ? (r[iTags] ?? '').trim() : '';
        const tags = tagsRaw ? tagsRaw.split('|').map((t) => t.trim()).filter(Boolean) : [];

        if (!filename || !collectionId || !title || !license || !author || !source) {
          errors.push(`Строка ${i + 1}: пустые обязательные поля`);
          continue;
        }
        validLicense(license);

        const [col2] = await this.db.select({ id: schema.libraryCollections.id }).from(schema.libraryCollections).where(eq(schema.libraryCollections.id, collectionId));
        if (!col2) { errors.push(`Строка ${i + 1}: коллекция ${collectionId} не найдена`); continue; }

        const fileBuf = fileMap.get(filename);
        if (!fileBuf) { errors.push(`Строка ${i + 1}: файл ${filename} не найден в ZIP`); continue; }

        // Сохраняем как медиафайл-заглушку для последующей обработки воркером
        const mediaId = createId();
        await this.db.insert(schema.media).values({
          id: mediaId,
          ownerId: adminId,
          kind: 'IMAGE',
          status: 'UPLOADED',
          mime: 'application/octet-stream',
          bytes: fileBuf.length,
          sha256: '',
          variants: {},
        });

        await this.db.insert(schema.libraryItems).values({
          id: createId(),
          collectionId,
          mediaId,
          fontId: null,
          title,
          tags,
          license: license as typeof LICENSES[number],
          author,
          source,
          attribution: attribution || null,
          rightsConfirmedById: adminId,
          rightsConfirmedAt: new Date(),
          active: false,
        });
        imported += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Строка ${i + 1}: ${msg}`);
      }
    }

    await this.audit.log({ action: 'LIBRARY_IMPORT', actorId: adminId, targetType: 'library_import', targetId: adminId, meta: { imported, errors: errors.length } });
    return { imported, errors };
  }

  /**
   * AD-10, LB-04 · снятие единицы. Деактивирует единицу — в опубликованных сборках ссылка
   * source:'library' вернёт stub='blocked' (через mediaOf в play.service.ts). Уведомляет авторов.
   */
  async withdrawItem(itemId: string, reason: string, adminId: string) {
    const [item] = await this.db
      .select({ id: schema.libraryItems.id, mediaId: schema.libraryItems.mediaId, title: schema.libraryItems.title })
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.id, itemId));
    if (!item) throw fail(404, 'NOT_FOUND', 'Единица не найдена');

    await this.db
      .update(schema.libraryItems)
      .set({ active: false, withdrawnAt: new Date(), withdrawReason: reason })
      .where(eq(schema.libraryItems.id, itemId));

    // Уведомляем создателей, использующих этот ресурс (LB-04)
    await this.notifyCreatorsUsingItem(itemId, item.title, reason);

    await this.audit.log({ action: 'LIBRARY_ITEM_WITHDRAW', actorId: adminId, targetType: 'library_item', targetId: itemId, meta: { reason } });
  }

  /** AD-10 · манифест лицензий: все активные единицы с карточками лицензий. */
  async licenseManifest() {
    const rows = await this.db
      .select({
        id: schema.libraryItems.id,
        collectionId: schema.libraryItems.collectionId,
        title: schema.libraryItems.title,
        license: schema.libraryItems.license,
        author: schema.libraryItems.author,
        source: schema.libraryItems.source,
        attribution: schema.libraryItems.attribution,
        tags: schema.libraryItems.tags,
        mediaId: schema.libraryItems.mediaId,
        fontId: schema.libraryItems.fontId,
        collectionTitle: schema.libraryCollections.title,
        collectionKind: schema.libraryCollections.kind,
      })
      .from(schema.libraryItems)
      .innerJoin(schema.libraryCollections, eq(schema.libraryCollections.id, schema.libraryItems.collectionId))
      .where(and(eq(schema.libraryItems.active, true), eq(schema.libraryCollections.active, true)))
      .orderBy(asc(schema.libraryCollections.sort), asc(schema.libraryItems.title));
    return rows;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * LB-04 · Notify creators whose published documents reference this library item.
   * The notification is best-effort — failures do not roll back the withdrawal.
   */
  private async notifyCreatorsUsingItem(itemId: string, itemTitle: string, reason: string): Promise<void> {
    try {
      // Find published project versions whose document JSON references this library item id.
      const versions = await this.db
        .select({ ownerId: schema.projects.ownerId, projectId: schema.projects.id, title: schema.projects.title })
        .from(schema.projectVersions)
        .innerJoin(schema.projects, eq(schema.projects.publishedVersionId, schema.projectVersions.id))
        .where(sql`${schema.projectVersions.document}::text like ${'%' + itemId + '%'}`);
      for (const v of versions) {
        await this.notify.notify({
          userId: v.ownerId,
          kind: 'LIBRARY_ITEM_WITHDRAWN',
          title: 'Ресурс библиотеки снят',
          body: `Ресурс «${itemTitle}» был снят с публикации${reason ? ': ' + reason : ''}. Он будет заменён заглушкой в ваших опубликованных сборках.`,
          projectId: v.projectId,
        });
      }
    } catch {
      // best-effort
    }
  }
}

/** Простой CSV-парсер (RFC 4180): поддерживает кавычки и переносы внутри кавычек. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const row: string[] = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; }
          else inQuote = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { row.push(field); field = ''; }
        else { field += ch; }
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}
