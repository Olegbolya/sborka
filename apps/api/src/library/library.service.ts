import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { LocalStorageService, servedKey } from '../media/storage.js';
import { fail } from '../admin/errors.js';
import { DB } from '../tokens.js';

export interface CollectionDto {
  id: string;
  kind: string;
  title: string;
  sort: number;
  itemCount: number;
}

export interface LibraryItemDto {
  id: string;
  collectionId: string;
  mediaId: string | null;
  fontId: string | null;
  /** What the file is (IMAGE, GIF, VIDEO, AUDIO, LOTTIE…) and how big: the editor needs it to choose the block and its proportions. */
  kind: string | null;
  width: number | null;
  height: number | null;
  title: string;
  tags: string[];
  license: string;
  author: string;
  source: string;
  attribution: string | null;
  createdAt: Date;
}

/** LB-02, TH-04 · a font of the library: the editor draws it with `@font-face` and offers it in «Шрифт». */
export interface LibraryFontDto {
  /** The number of the font: the document refers to it as `{kind:'font', id}`. */
  id: string;
  itemId: string;
  title: string;
  family: string;
  hasCyrillic: boolean;
  /** The weights found in the file: «400», «700i»… */
  styles: string[];
}

/** LB-01, LB-02 · публичный API библиотеки платформы (только для авторизованных пользователей). */
@Injectable()
export class LibraryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: LocalStorageService,
  ) {}

  /** LB-02 · the file of an active item for a signed-in person (the editor shows it; the player uses the address of the published project). */
  async fileOf(itemId: string): Promise<{ path: string; mime: string }> {
    const [row] = await this.db
      .select({ ownerId: schema.media.ownerId, mediaId: schema.media.id, mime: schema.media.mime, status: schema.media.status, variants: schema.media.variants })
      .from(schema.libraryItems)
      .innerJoin(schema.media, eq(schema.media.id, schema.libraryItems.mediaId))
      .where(and(eq(schema.libraryItems.id, itemId), eq(schema.libraryItems.active, true), isNull(schema.media.deletedAt)));
    if (!row || !row.ownerId || row.status === 'BLOCKED' || row.status === 'REJECTED') throw fail(404, 'NOT_FOUND', 'Файл библиотеки не найден');
    return { path: this.storage.getPath(servedKey(row.ownerId, row.mediaId, row.variants)), mime: row.mime };
  }

  /** LB-02 · the active fonts of the library (all, or those with these numbers). */
  async fonts(ids?: string[]): Promise<LibraryFontDto[]> {
    const conditions = [eq(schema.libraryItems.active, true), isNull(schema.fonts.deletedAt)];
    if (ids) conditions.push(inArray(schema.fonts.id, ids.length > 0 ? ids.slice(0, 100) : ['-']));
    const rows = await this.db
      .select({ item: schema.libraryItems.id, title: schema.libraryItems.title, font: schema.fonts })
      .from(schema.libraryItems)
      .innerJoin(schema.fonts, eq(schema.fonts.id, schema.libraryItems.fontId))
      .where(and(...conditions))
      .orderBy(asc(schema.libraryItems.title))
      .limit(200);
    return rows.map((r) => ({ id: r.font.id, itemId: r.item, title: r.title, family: r.font.family, hasCyrillic: r.font.hasCyrillic, styles: Object.keys(r.font.styles) }));
  }

  /** LB-02 · the WOFF2 file of one weight of an active library font (the editor of a signed-in person). */
  async fontFile(fontId: string, style: string): Promise<{ path: string; mime: string }> {
    const [row] = await this.db
      .select({ styles: schema.fonts.styles })
      .from(schema.libraryItems)
      .innerJoin(schema.fonts, eq(schema.fonts.id, schema.libraryItems.fontId))
      .where(and(eq(schema.fonts.id, fontId), eq(schema.libraryItems.active, true), isNull(schema.fonts.deletedAt)));
    const mediaId = row?.styles[style]?.mediaId;
    if (!mediaId) throw fail(404, 'NOT_FOUND', 'Шрифт библиотеки не найден');
    const [m] = await this.db
      .select({ ownerId: schema.media.ownerId, mime: schema.media.mime, status: schema.media.status, variants: schema.media.variants })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), isNull(schema.media.deletedAt)));
    if (!m || !m.ownerId || m.status === 'BLOCKED' || m.status === 'REJECTED') throw fail(404, 'NOT_FOUND', 'Шрифт библиотеки не найден');
    return { path: this.storage.getPath(servedKey(m.ownerId, mediaId, m.variants)), mime: m.mime };
  }

  /** LB-01 · список активных коллекций. */
  async listCollections(): Promise<CollectionDto[]> {
    const rows = await this.db
      .select({
        id: schema.libraryCollections.id,
        kind: schema.libraryCollections.kind,
        title: schema.libraryCollections.title,
        sort: schema.libraryCollections.sort,
        itemCount: sql<number>`(select count(*) from library_items li where li.collection_id = "library_collections"."id" and li.active = true)::int`,
      })
      .from(schema.libraryCollections)
      .where(eq(schema.libraryCollections.active, true))
      .orderBy(asc(schema.libraryCollections.sort), asc(schema.libraryCollections.title));
    return rows;
  }

  /** LB-02 · the active items with these numbers (the editor asks for those that the document already uses; a withdrawn item is simply absent). */
  async itemsByIds(ids: string[]): Promise<LibraryItemDto[]> {
    const wanted = [...new Set(ids)].slice(0, 100);
    if (wanted.length === 0) return [];
    const rows = await this.db
      .select({ item: schema.libraryItems, kind: schema.media.kind, width: schema.media.width, height: schema.media.height })
      .from(schema.libraryItems)
      .leftJoin(schema.media, eq(schema.media.id, schema.libraryItems.mediaId))
      .where(and(inArray(schema.libraryItems.id, wanted), eq(schema.libraryItems.active, true)))
      .orderBy(asc(schema.libraryItems.title));
    return rows.map((r) => toItemDto(r.item, { kind: r.kind ?? null, width: r.width ?? null, height: r.height ?? null }));
  }

  /** LB-02 · единицы коллекции с поиском и фильтром по тегам. */
  async listItems(collectionId: string, opts: { search?: string; tags?: string[] } = {}): Promise<LibraryItemDto[]> {
    const [col] = await this.db
      .select({ id: schema.libraryCollections.id })
      .from(schema.libraryCollections)
      .where(and(eq(schema.libraryCollections.id, collectionId), eq(schema.libraryCollections.active, true)));
    if (!col) return [];

    const conditions = [
      eq(schema.libraryItems.collectionId, collectionId),
      eq(schema.libraryItems.active, true),
    ];
    if (opts.tags?.length) {
      // PostgreSQL array overlap: tags && ARRAY['t1','t2']
      conditions.push(sql`${schema.libraryItems.tags} && array[${sql.join(opts.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`);
    }
    if (opts.search) {
      const q = `%${opts.search.toLowerCase()}%`;
      conditions.push(or(
        sql`lower(${schema.libraryItems.title}) like ${q}`,
        sql`exists (select 1 from unnest(${schema.libraryItems.tags}) t where lower(t) like ${q})`,
      )!);
    }

    const rows = await this.db
      .select({ item: schema.libraryItems, kind: schema.media.kind, width: schema.media.width, height: schema.media.height })
      .from(schema.libraryItems)
      .leftJoin(schema.media, eq(schema.media.id, schema.libraryItems.mediaId))
      .where(and(...conditions))
      .orderBy(asc(schema.libraryItems.title));
    return rows.map((r) => toItemDto(r.item, { kind: r.kind ?? null, width: r.width ?? null, height: r.height ?? null }));
  }
}

function toItemDto(r: typeof schema.libraryItems.$inferSelect, file: { kind: string | null; width: number | null; height: number | null }): LibraryItemDto {
  return {
    id: r.id,
    collectionId: r.collectionId,
    mediaId: r.mediaId ?? null,
    fontId: r.fontId ?? null,
    ...file,
    title: r.title,
    tags: r.tags,
    license: r.license,
    author: r.author,
    source: r.source,
    attribution: r.attribution ?? null,
    createdAt: r.createdAt,
  };
}
