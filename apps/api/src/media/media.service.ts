import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException, HttpException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { FeatureFlagsService } from '../admin/feature-flags.service.js';
import { and, eq, isNull, sql, sum } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createId } from '@blokum/schema';
import { DB, MEDIA_QUEUE } from '../tokens.js';
import { checkSignature, SignatureError } from './signatures.js';
import { checkFileSize, checkStorageQuota, QuotaError } from './entitlements.js';
import { LocalStorageService } from './storage.js';
import { MEDIA_PROCESS_JOB, type IMediaQueue } from './media-jobs.js';

export interface UploadedMediaDto {
  id: string;
  kind: string;
  status: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface MediaListItem extends UploadedMediaDto {
  variants: Record<string, unknown>;
}

export interface MediaUsage {
  kind: 'theme' | 'template' | 'library_item';
  id: string;
  name: string;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MEDIA_QUEUE) private readonly queue: IMediaQueue,
    private readonly storage: LocalStorageService,
    @Optional() private readonly flags?: FeatureFlagsService,
  ) {}

  /** P4.1/B-02…B-07: Direct upload from buffer (multer memoryStorage). */
  async uploadBuffer(ownerId: string, buffer: Buffer): Promise<UploadedMediaDto> {
    await this.flags?.require('UPLOADS_ENABLED', 'Загрузка файлов временно отключена.');
    const result = await checkSignature(buffer).catch((e: unknown) => {
      if (e instanceof SignatureError) throw makeError(e.code, e.message);
      throw e;
    });
    const { kind, mime } = result;

    try { checkFileSize(kind, buffer.length); } catch (e) {
      if (e instanceof QuotaError) throw makeError(e.code, e.message); throw e;
    }
    await this.checkQuota(ownerId, buffer.length);

    const mediaId = createId();
    const key = `${ownerId}/${mediaId}`;
    await this.storage.save(Readable.from(buffer), key);

    const sha256 = computeSha256(buffer);
    const [row] = await this.db
      .insert(schema.media)
      .values({ id: mediaId, ownerId, kind, status: 'UPLOADED', mime, bytes: buffer.length, sha256, variants: {} })
      .returning();
    if (!row) throw new Error('Запись медиафайла не создана');

    await this.queue.add(MEDIA_PROCESS_JOB, { mediaId, ownerId, filePath: this.storage.getPath(key), mime, kind });

    return rowToDto(row);
  }

  /** P4.1: Start a chunked upload session. Returns sessionId. */
  async startSession(ownerId: string, totalBytes: number): Promise<string> {
    await this.flags?.require('UPLOADS_ENABLED', 'Загрузка файлов временно отключена.');
    // Validate against the maximum FREE-tier file limit (video 30 MB is biggest).
    if (totalBytes > 30 * 1024 * 1024) {
      throw makeError('FILE_TOO_LARGE', 'Файл превышает максимально допустимый размер для тарифа FREE (30 МБ)');
    }
    await this.checkQuota(ownerId, totalBytes);
    const sessionId = createId();
    const sessionPath = this.storage.getPath(`tmp/session_${sessionId}`);
    await mkdir(path.dirname(sessionPath), { recursive: true });
    return sessionId;
  }

  /** P4.1: Append a chunk to an existing upload session. */
  async appendChunk(_ownerId: string, sessionId: string, chunk: Buffer): Promise<{ received: number }> {
    const sessionPath = this.storage.getPath(`tmp/session_${sessionId}`);
    await appendFile(sessionPath, chunk);
    const s = await stat(sessionPath);
    return { received: s.size };
  }

  /** P4.1: Finalise a chunked upload — validate, create record, enqueue job. */
  async completeSession(ownerId: string, sessionId: string): Promise<UploadedMediaDto> {
    const sessionPath = this.storage.getPath(`tmp/session_${sessionId}`);
    const buffer = await readFile(sessionPath).catch(() => {
      throw makeError('SESSION_NOT_FOUND', 'Сессия загрузки не найдена или истекла');
    });

    const result = await checkSignature(buffer).catch((e: unknown) => {
      if (e instanceof SignatureError) throw makeError(e.code, e.message);
      throw e;
    });
    const { kind, mime } = result;

    try { checkFileSize(kind, buffer.length); } catch (e) {
      if (e instanceof QuotaError) throw makeError(e.code, e.message); throw e;
    }
    await this.checkQuota(ownerId, buffer.length);

    const mediaId = createId();
    const destPath = this.storage.getPath(`${ownerId}/${mediaId}`);
    await this.storage.move(sessionPath, destPath);

    const sha256 = computeSha256(buffer);
    const [row] = await this.db
      .insert(schema.media)
      .values({ id: mediaId, ownerId, kind, status: 'UPLOADED', mime, bytes: buffer.length, sha256, variants: {} })
      .returning();
    if (!row) throw new Error('Запись медиафайла не создана');

    await this.queue.add(MEDIA_PROCESS_JOB, { mediaId, ownerId, filePath: destPath, mime, kind });

    return rowToDto(row);
  }

  /** P4.4/D-08: List user's media files with cursor pagination. */
  async list(ownerId: string, opts: { kind?: string; cursor?: string; limit?: number }): Promise<{ items: MediaListItem[]; nextCursor: string | null }> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const filters = [
      eq(schema.media.ownerId, ownerId),
      isNull(schema.media.deletedAt),
      opts.kind ? eq(schema.media.kind, opts.kind as typeof schema.media.$inferSelect.kind) : undefined,
      opts.cursor
        ? sql`${schema.media.createdAt} < (select created_at from ${schema.media} where id = ${opts.cursor})`
        : undefined,
    ].filter(Boolean) as Parameters<typeof and>;

    const rows = await this.db
      .select()
      .from(schema.media)
      .where(and(...filters))
      .orderBy(sql`${schema.media.createdAt} desc`)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(rowToListDto);
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  /**
   * The owner's own file for the editor (a photo in a fill, a preview): the original as it was uploaded. The public
   * player gets processed files from the media domain (P4.3); this one never serves anybody but the owner.
   */
  async fileOf(ownerId: string, mediaId: string): Promise<{ path: string; mime: string }> {
    const [row] = await this.db
      .select({ mime: schema.media.mime, status: schema.media.status })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, ownerId), isNull(schema.media.deletedAt)));
    if (!row || row.status === 'BLOCKED' || row.status === 'REJECTED') throw makeError('NOT_FOUND', 'Медиафайл не найден');
    return { path: this.storage.getPath(`${ownerId}/${mediaId}`), mime: row.mime };
  }

  /** P4.4/D-08: Delete media — block if in use unless confirm=true. */
  async delete(
    ownerId: string,
    mediaId: string,
    confirm: boolean,
  ): Promise<{ deleted: boolean; usages: MediaUsage[] }> {
    const [row] = await this.db
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, ownerId), isNull(schema.media.deletedAt)));
    if (!row) throw makeError('NOT_FOUND', 'Медиафайл не найден');

    const usages = await this.findUsages(mediaId);
    if (usages.length > 0 && !confirm) {
      return { deleted: false, usages };
    }

    await this.db.update(schema.media).set({ deletedAt: new Date() }).where(eq(schema.media.id, mediaId));
    await this.storage.delete(`${ownerId}/${mediaId}`);

    return { deleted: true, usages: [] };
  }

  private async findUsages(mediaId: string): Promise<MediaUsage[]> {
    const usages: MediaUsage[] = [];

    const themes = await this.db
      .select({ id: schema.themes.id, name: schema.themes.name })
      .from(schema.themes)
      .where(and(eq(schema.themes.coverMediaId, mediaId), isNull(schema.themes.deletedAt)));
    for (const t of themes) usages.push({ kind: 'theme', id: t.id, name: t.name });

    const tmpl = await this.db
      .select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(and(eq(schema.templates.coverMediaId, mediaId), isNull(schema.templates.deletedAt)));
    for (const t of tmpl) usages.push({ kind: 'template', id: t.id, name: t.name });

    const lib = await this.db
      .select({ id: schema.libraryItems.id, title: schema.libraryItems.title })
      .from(schema.libraryItems)
      .where(and(eq(schema.libraryItems.mediaId, mediaId), eq(schema.libraryItems.active, true)));
    for (const t of lib) usages.push({ kind: 'library_item', id: t.id, name: t.title });

    return usages;
  }

  private async checkQuota(ownerId: string, fileBytes: number): Promise<void> {
    const [result] = await this.db
      .select({ total: sum(schema.media.bytes) })
      .from(schema.media)
      .where(and(eq(schema.media.ownerId, ownerId), isNull(schema.media.deletedAt)));
    const used = Number(result?.total ?? 0);
    try {
      checkStorageQuota(used, fileBytes);
    } catch (e) {
      if (e instanceof QuotaError) throw makeError(e.code, e.message);
      throw e;
    }
  }
}

function makeError(code: string, message: string): HttpException {
  const body = { error: { code, message } };
  if (code === 'NOT_FOUND') return new NotFoundException(body);
  if (code === 'QUOTA_EXCEEDED') return new HttpException(body, 402);
  return new BadRequestException(body);
}

function rowToDto(row: typeof schema.media.$inferSelect): UploadedMediaDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

function rowToListDto(row: typeof schema.media.$inferSelect): MediaListItem {
  return { ...rowToDto(row), variants: row.variants ?? {} };
}

function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
