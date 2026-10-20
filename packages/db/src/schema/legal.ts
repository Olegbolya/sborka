import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './columns.js';
import { consentSubjectType, legalDocumentType } from './enums.js';

export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: id(),
    type: legalDocumentType('type').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    bodyMd: text('body_md').notNull(),
    contentSha256: text('content_sha256').notNull(),
    publishedAt: ts('published_at'),
    effectiveAt: ts('effective_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('legal_documents_type_version_uq').on(t.type, t.version)],
);

/** Evidence of consent (152-ФЗ ч. 3 ст. 9). Kept after the subject is deleted, so no foreign key on subject. */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    subjectType: consentSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    legalDocumentId: text('legal_document_id').references(() => legalDocuments.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
    withdrawnAt: ts('withdrawn_at'),
    ipHash: text('ip_hash'),
    uaFamily: text('ua_family'),
    evidence: jsonb('evidence').$type<{ checkboxText: string; documentUrl?: string; [k: string]: unknown }>().notNull(),
  },
  (t) => [index('consent_subject_idx').on(t.subjectType, t.subjectId)],
);
