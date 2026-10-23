import { createHash, createHmac } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { DB } from '../tokens.js';
import { LegalDocumentService } from './legal-document.service.js';

/** Required document types for onboarding (A-02). */
const REQUIRED_TYPES: Array<(typeof schema.legalDocuments.$inferInsert)['type']> = ['TOS', 'PD_CONSENT_USER'];

function generateId(): string {
  return createHash('sha256').update(Math.random().toString() + Date.now()).digest('hex').slice(0, 24);
}

function hashIp(ip: string): string {
  const salt = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);
}

export interface PendingDocument {
  id: string;
  type: string;
  version: number;
  title: string;
}

export interface RecordConsentsInput {
  documentIds: string[];
  ageConfirmed: boolean;
  marketingConsentDocId?: string;
  ip: string;
  ua: string;
}

@Injectable()
export class ConsentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly legalDocs: LegalDocumentService,
  ) {}

  /** A-02: returns required docs the user hasn't consented to (latest version). */
  async getPendingConsents(userId: string): Promise<PendingDocument[]> {
    const pending: PendingDocument[] = [];
    for (const type of REQUIRED_TYPES) {
      const doc = await this.legalDocs.getLatest(type);
      if (!doc) continue;
      const existing = await this.db
        .select({ id: schema.consentRecords.id })
        .from(schema.consentRecords)
        .where(
          and(
            eq(schema.consentRecords.subjectType, 'USER'),
            eq(schema.consentRecords.subjectId, userId),
            eq(schema.consentRecords.legalDocumentId, doc.id),
            isNull(schema.consentRecords.withdrawnAt),
          ),
        )
        .limit(1);
      if (!existing[0]) {
        pending.push({ id: doc.id, type: doc.type, version: doc.version, title: doc.title });
      }
    }
    return pending;
  }

  /** A-02: records consent for the given document IDs. §2.5 of 05-LEGAL.md — one record per doc per version. */
  async recordConsents(userId: string, input: RecordConsentsInput): Promise<void> {
    if (!input.ageConfirmed) {
      throw new BadRequestException({ error: { code: 'AGE_NOT_CONFIRMED', message: 'Необходимо подтвердить возраст' } });
    }
    const ids = [...input.documentIds, ...(input.marketingConsentDocId ? [input.marketingConsentDocId] : [])];
    if (!ids.length) return;

    // Verify all documentIds are known legal documents.
    const docs = await this.db
      .select({ id: schema.legalDocuments.id, type: schema.legalDocuments.type, title: schema.legalDocuments.title, version: schema.legalDocuments.version })
      .from(schema.legalDocuments)
      .where(inArray(schema.legalDocuments.id, ids));
    if (docs.length !== ids.length) {
      throw new BadRequestException({ error: { code: 'INVALID_DOCUMENT', message: 'Один или несколько документов не найдены' } });
    }

    const ipHash = input.ip ? hashIp(input.ip) : null;
    const uaFamily = parseUaFamily(input.ua);
    const now = new Date();

    for (const doc of docs) {
      const checkboxText = doc.type === 'MARKETING'
        ? `Согласен получать рекламные сообщения (${doc.title}, версия ${doc.version})`
        : `Согласен с документом «${doc.title}» версии ${doc.version}`;
      await this.db.insert(schema.consentRecords).values({
        id: generateId(),
        subjectType: 'USER',
        subjectId: userId,
        legalDocumentId: doc.id,
        kind: doc.type === 'MARKETING' ? 'marketing_consent' : 'onboarding',
        acceptedAt: now,
        ipHash,
        uaFamily,
        evidence: { checkboxText, documentUrl: `/legal/documents/${doc.type.toLowerCase()}` },
      });
    }
  }

  /** A-02: returns true if user has consented to all required documents (latest versions). */
  async hasCompletedOnboarding(userId: string): Promise<boolean> {
    const pending = await this.getPendingConsents(userId);
    return pending.length === 0;
  }

  /** Returns the latest consent record for a document type, or null. Used for re-acceptance check. */
  async getLatestConsent(userId: string, docType: (typeof schema.legalDocuments.$inferInsert)['type']): Promise<Date | null> {
    const doc = await this.legalDocs.getLatest(docType);
    if (!doc) return null;
    const rows = await this.db
      .select({ acceptedAt: schema.consentRecords.acceptedAt })
      .from(schema.consentRecords)
      .where(
        and(
          eq(schema.consentRecords.subjectType, 'USER'),
          eq(schema.consentRecords.subjectId, userId),
          eq(schema.consentRecords.legalDocumentId, doc.id),
          isNull(schema.consentRecords.withdrawnAt),
        ),
      )
      .orderBy(desc(schema.consentRecords.acceptedAt))
      .limit(1);
    return rows[0]?.acceptedAt ?? null;
  }
}

function parseUaFamily(ua: string): string | null {
  if (/\bChrome\//.test(ua) && !/\bEdg\//.test(ua)) return 'Chrome';
  if (/\bFirefox\//.test(ua)) return 'Firefox';
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return 'Safari';
  return null;
}
