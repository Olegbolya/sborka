import { bigserial, boolean, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { createdAt, id, ts } from './columns.js';
import {
  appealStatus,
  caseStatus,
  copyrightClaimStatus,
  dataRequestKind,
  moderationActionKind,
  moderationTarget,
  reportPriority,
  reportStatus,
} from './enums.js';
import { media } from './content.js';
import { projectVersions, projects } from './projects.js';

export const reports = pgTable(
  'reports',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    mediaId: text('media_id').references(() => media.id, { onDelete: 'set null' }),
    snapshotVersionId: text('snapshot_version_id').references(() => projectVersions.id, { onDelete: 'set null' }),
    category: text('category').notNull(),
    text: text('text').notNull(),
    reporterContact: text('reporter_contact'),
    reporterIpHash: text('reporter_ip_hash'),
    priority: reportPriority('priority').notNull(),
    status: reportStatus('status').notNull().default('NEW'),
    slaDueAt: ts('sla_due_at').notNull(),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
    resolution: text('resolution'),
    /** AD-03: the moderator who took the complaint. */
    assigneeId: text('assignee_id'),
  },
  (t) => [index('reports_status_due_idx').on(t.status, t.slaDueAt), index('reports_project_idx').on(t.projectId)],
);

/** Copyright holder's notice under 149-ФЗ ст. 15.7 (fields of part 2 are in `claimant`/`statement`). */
export const copyrightClaims = pgTable(
  'copyright_claims',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    claimant: jsonb('claimant').$type<Record<string, unknown>>().notNull(),
    objectDescription: text('object_description').notNull(),
    urls: text('urls').array().notNull(),
    statement: jsonb('statement').$type<Record<string, unknown>>().notNull(),
    attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
    status: copyrightClaimStatus('status').notNull().default('NEW'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    clarifyRequestedAt: ts('clarify_requested_at'),
    dueAt: ts('due_at').notNull(),
    resolvedAt: ts('resolved_at'),
    resolution: text('resolution'),
  },
  (t) => [index('copyright_claims_status_due_idx').on(t.status, t.dueAt)],
);

export const authorityRequests = pgTable(
  'authority_requests',
  {
    id: id(),
    source: text('source').notNull(),
    number: text('number').notNull(),
    receivedAt: ts('received_at').notNull(),
    dueAt: ts('due_at').notNull(),
    subject: text('subject').notNull(),
    actions: jsonb('actions').$type<Array<{ at: string; action: string }>>().notNull().default([]),
    status: caseStatus('status').notNull().default('NEW'),
    closedAt: ts('closed_at'),
  },
  (t) => [index('authority_requests_due_idx').on(t.status, t.dueAt)],
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: id(),
    targetType: moderationTarget('target_type').notNull(),
    targetId: text('target_id').notNull(),
    action: moderationActionKind('action').notNull(),
    reasonCode: text('reason_code').notNull(),
    note: text('note').notNull(),
    actorId: text('actor_id').notNull(),
    reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    /** What the action changed (the state before it): `RESTORE` puts it back. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('moderation_actions_target_idx').on(t.targetType, t.targetId)],
);

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: id(),
    kind: dataRequestKind('kind').notNull(),
    subjectContact: text('subject_contact').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    details: text('details').notNull(),
    status: caseStatus('status').notNull().default('NEW'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    dueAt: ts('due_at').notNull(),
    closedAt: ts('closed_at'),
  },
  (t) => [index('data_subject_requests_due_idx').on(t.status, t.dueAt)],
);

/**
 * Append-only audit log (AD-08). UPDATE and DELETE are rejected by a database trigger
 * (migration 0001_audit_log_append_only), so even a bug in the API cannot rewrite history.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    ipHash: text('ip_hash'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_target_idx').on(t.targetType, t.targetId), index('audit_log_created_idx').on(t.createdAt)],
);

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  note: text('note').notNull().default(''),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedById: text('updated_by_id'),
});

/** The creator's appeal against a moderation action (docs/06-TRUST-SAFETY.md §5); another moderator decides. */
export const appeals = pgTable(
  'appeals',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: text('action_id')
      .notNull()
      .references(() => moderationActions.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    status: appealStatus('status').notNull().default('NEW'),
    reviewerId: text('reviewer_id'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    decidedAt: ts('decided_at'),
  },
  (t) => [index('appeals_status_idx').on(t.status, t.createdAt), index('appeals_user_idx').on(t.userId)],
);

/** A message to a user in the cabinet (and by mail when the address is confirmed): moderation decisions, appeal answers. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    readAt: ts('read_at'),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);
