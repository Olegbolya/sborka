import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
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
  title: string;
  tags: string[];
  license: string;
  author: string;
  source: string;
  attribution: string | null;
  createdAt: Date;
}

/** LB-01, LB-02 · публичный API библиотеки платформы (только для авторизованных пользователей). */
@Injectable()
export class LibraryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** LB-01 · список активных коллекций. */
  async listCollections(): Promise<CollectionDto[]> {
    const rows = await this.db
      .select({
        id: schema.libraryCollections.id,
        kind: schema.libraryCollections.kind,
        title: schema.libraryCollections.title,
        sort: schema.libraryCollections.sort,
        itemCount: sql<number>`(select count(*) from library_items li where li.collection_id = ${schema.libraryCollections.id} and li.active = true)::int`,
      })
      .from(schema.libraryCollections)
      .where(eq(schema.libraryCollections.active, true))
      .orderBy(asc(schema.libraryCollections.sort), asc(schema.libraryCollections.title));
    return rows;
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
      .select()
      .from(schema.libraryItems)
      .where(and(...conditions))
      .orderBy(asc(schema.libraryItems.title));
    return rows.map(toItemDto);
  }
}

function toItemDto(r: typeof schema.libraryItems.$inferSelect): LibraryItemDto {
  return {
    id: r.id,
    collectionId: r.collectionId,
    mediaId: r.mediaId ?? null,
    fontId: r.fontId ?? null,
    title: r.title,
    tags: r.tags,
    license: r.license,
    author: r.author,
    source: r.source,
    attribution: r.attribution ?? null,
    createdAt: r.createdAt,
  };
}
