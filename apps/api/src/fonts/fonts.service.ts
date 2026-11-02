import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createId } from '@blokum/schema';
import { DB } from '../tokens.js';
import { LocalStorageService } from '../media/storage.js';
import { processFont } from './font-processor.js';

export interface FontDto {
  id: string;
  family: string;
  styles: Record<string, { mediaId: string }>;
  hasCyrillic: boolean;
  createdAt: Date;
}

@Injectable()
export class FontsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: LocalStorageService,
  ) {}

  /**
   * Обрабатывает загруженный файл шрифта, сохраняет WOFF2 как медиафайл,
   * создаёт или обновляет запись шрифта (группировка по family + ownerId).
   */
  async upload(ownerId: string, buffer: Buffer): Promise<FontDto> {
    let result: Awaited<ReturnType<typeof processFont>>;
    try {
      result = await processFont(buffer);
    } catch (e: unknown) {
      const err = e as { status?: number; code?: string; message?: string };
      if (err.status === 400) {
        throw new BadRequestException({ error: { code: err.code ?? 'FONT_ERROR', message: err.message ?? 'Ошибка обработки шрифта' } });
      }
      throw e;
    }

    const { family, styleKey, hasCyrillic, woff2Buffer } = result;

    // Сохраняем WOFF2 как медиафайл (kind=FONT_SOURCE, status=READY)
    const mediaId = createId();
    const key = `${ownerId}/${mediaId}`;
    await this.storage.save(Readable.from(woff2Buffer), key);

    await this.db.insert(schema.media).values({
      id: mediaId,
      ownerId,
      kind: 'FONT_SOURCE',
      status: 'READY',
      mime: 'font/woff2',
      bytes: woff2Buffer.length,
      sha256: computeSha256(woff2Buffer),
      variants: {},
    });

    // Ищем существующую запись шрифта с таким же family и ownerId
    const [existing] = await this.db
      .select()
      .from(schema.fonts)
      .where(and(eq(schema.fonts.ownerId, ownerId), eq(schema.fonts.family, family), isNull(schema.fonts.deletedAt)));

    let fontId: string;
    let styles: Record<string, { mediaId: string }>;

    if (existing) {
      fontId = existing.id;
      // Обновляем стили: добавляем/перезаписываем данный стиль
      styles = { ...existing.styles, [styleKey]: { mediaId } };
      await this.db
        .update(schema.fonts)
        .set({ styles, hasCyrillic: existing.hasCyrillic || hasCyrillic })
        .where(eq(schema.fonts.id, fontId));
    } else {
      fontId = createId();
      styles = { [styleKey]: { mediaId } };
      await this.db.insert(schema.fonts).values({
        id: fontId,
        ownerId,
        family,
        styles,
        hasCyrillic,
      });
    }

    const [row] = await this.db
      .select()
      .from(schema.fonts)
      .where(eq(schema.fonts.id, fontId));
    if (!row) throw new Error('Запись шрифта не найдена после создания');
    return toDto(row);
  }

  /** Список шрифтов пользователя (не удалённых). */
  async list(ownerId: string): Promise<FontDto[]> {
    const rows = await this.db
      .select()
      .from(schema.fonts)
      .where(and(eq(schema.fonts.ownerId, ownerId), isNull(schema.fonts.deletedAt)));
    return rows.map(toDto);
  }

  /** Мягкое удаление шрифта. */
  async delete(ownerId: string, fontId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: schema.fonts.id })
      .from(schema.fonts)
      .where(and(eq(schema.fonts.id, fontId), eq(schema.fonts.ownerId, ownerId), isNull(schema.fonts.deletedAt)));
    if (!row) throw new NotFoundException({ error: { code: 'FONT_NOT_FOUND', message: 'Шрифт не найден' } });
    await this.db.update(schema.fonts).set({ deletedAt: new Date() }).where(eq(schema.fonts.id, fontId));
  }

  /** Получить шрифты по списку ID (для плеера). */
  async findByIds(fontIds: string[]): Promise<typeof schema.fonts.$inferSelect[]> {
    if (fontIds.length === 0) return [];
    return this.db
      .select()
      .from(schema.fonts)
      .where(and(inArray(schema.fonts.id, fontIds), isNull(schema.fonts.deletedAt)));
  }
}

function toDto(row: typeof schema.fonts.$inferSelect): FontDto {
  return {
    id: row.id,
    family: row.family,
    styles: row.styles,
    hasCyrillic: row.hasCyrillic,
    createdAt: row.createdAt,
  };
}

function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
