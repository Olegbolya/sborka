import { type AnyPgColumn, boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './columns.js';
import { accessPointKind, moderationStatus, projectStatus, versionKind } from './enums.js';
import { themes } from './content.js';
import { users } from './users.js';

/** Project document JSON; its exact shape is validated by @blokum/schema (task P1.1). */
export type ProjectDocumentJson = { schemaVersion: number; [key: string]: unknown };

export const projects = pgTable(
  'projects',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: projectStatus('status').notNull().default('DRAFT'),
    moderationStatus: moderationStatus('moderation_status').notNull().default('NONE'),
    ageRating: integer('age_rating'),
    isAdvertising: boolean('is_advertising').notNull().default(false),
    adMarking: jsonb('ad_marking').$type<{ advertiser: string; inn?: string; erid: string }>(),
    operatorInfo: jsonb('operator_info').$type<Record<string, unknown>>(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    themeId: text('theme_id').references((): AnyPgColumn => themes.id, { onDelete: 'set null' }),
    draftVersionId: text('draft_version_id').references((): AnyPgColumn => projectVersions.id, { onDelete: 'set null' }),
    publishedVersionId: text('published_version_id').references((): AnyPgColumn => projectVersions.id, {
      onDelete: 'set null',
    }),
    publishedAt: ts('published_at'),
    closedReason: text('closed_reason'),
    legalHold: boolean('legal_hold').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('projects_slug_uq').on(t.slug),
    index('projects_owner_status_idx').on(t.ownerId, t.status, t.updatedAt),
    index('projects_deleted_idx').on(t.deletedAt),
  ],
);

export const projectVersions = pgTable(
  'project_versions',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    document: jsonb('document').$type<ProjectDocumentJson>().notNull(),
    schemaVersion: integer('schema_version').notNull(),
    sha256: text('sha256').notNull(),
    kind: versionKind('kind').notNull(),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('project_versions_number_uq').on(t.projectId, t.number), index('project_versions_kind_idx').on(t.projectId, t.kind)],
);

export const accessPoints = pgTable(
  'access_points',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: accessPointKind('kind').notNull().default('LINK'),
    label: text('label').notNull(),
    qrStyle: jsonb('qr_style').$type<Record<string, unknown>>(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('access_points_code_uq').on(t.code), index('access_points_project_idx').on(t.projectId)],
);
