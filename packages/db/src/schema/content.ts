import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './columns.js';
import { assetLicense, libraryKind, mediaKind, mediaStatus } from './enums.js';
import { users } from './users.js';

export const media = pgTable(
  'media',
  {
    id: id(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    status: mediaStatus('status').notNull().default('UPLOADED'),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sha256: text('sha256').notNull(),
    phash: text('phash'),
    palette: jsonb('palette').$type<string[]>(),
    variants: jsonb('variants').$type<Record<string, unknown>>().notNull().default({}),
    moderation: jsonb('moderation').$type<Record<string, unknown>>().notNull().default({}),
    legalHold: boolean('legal_hold').notNull().default(false),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('media_owner_created_idx').on(t.ownerId, t.createdAt),
    index('media_sha256_idx').on(t.sha256),
    index('media_phash_idx').on(t.phash),
  ],
);

/** Theme tokens JSON (TH-01); validated by @blokum/schema. `ownerId = null` means a system theme. */
export const themes = pgTable(
  'themes',
  {
    id: id(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokens: jsonb('tokens').$type<Record<string, unknown>>().notNull(),
    coverMediaId: text('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    isSystem: boolean('is_system').notNull().default(false),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('themes_owner_idx').on(t.ownerId), index('themes_system_idx').on(t.isSystem, t.publishedAt)],
);

export const templates = pgTable(
  'templates',
  {
    id: id(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'),
    coverMediaId: text('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    document: jsonb('document').$type<Record<string, unknown>>().notNull(),
    sourceProjectId: text('source_project_id'),
    isSystem: boolean('is_system').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('templates_owner_idx').on(t.ownerId), index('templates_system_idx').on(t.isSystem, t.category, t.sort)],
);

export const savedElements = pgTable(
  'saved_elements',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    coverMediaId: text('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    fragment: jsonb('fragment').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('saved_elements_owner_idx').on(t.ownerId)],
);

export const fonts = pgTable(
  'fonts',
  {
    id: id(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    family: text('family').notNull(),
    styles: jsonb('styles').$type<Record<string, { mediaId: string }>>().notNull(),
    hasCyrillic: boolean('has_cyrillic').notNull(),
    license: text('license'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('fonts_owner_idx').on(t.ownerId)],
);

export const libraryCollections = pgTable('library_collections', {
  id: id(),
  kind: libraryKind('kind').notNull(),
  title: text('title').notNull(),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const libraryItems = pgTable(
  'library_items',
  {
    id: id(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => libraryCollections.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').references(() => media.id, { onDelete: 'restrict' }),
    fontId: text('font_id').references(() => fonts.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    license: assetLicense('license').notNull(),
    author: text('author').notNull(),
    source: text('source').notNull(),
    attribution: text('attribution'),
    rightsConfirmedById: text('rights_confirmed_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    rightsConfirmedAt: ts('rights_confirmed_at').notNull().defaultNow(),
    active: boolean('active').notNull().default(true),
    withdrawnAt: ts('withdrawn_at'),
    withdrawReason: text('withdraw_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('library_items_collection_idx').on(t.collectionId, t.active),
    index('library_items_tags_idx').using('gin', t.tags),
    // Exactly one asset: a media file or a font (LB-01).
    check('library_items_one_asset_ck', sql`(${t.mediaId} IS NOT NULL) <> (${t.fontId} IS NOT NULL)`),
  ],
);
