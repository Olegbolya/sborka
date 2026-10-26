import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { DB } from '../tokens.js';

/** Map from DB document type to the markdown file in legal/. */
const DRAFT_DOCS: Array<{ type: (typeof schema.legalDocuments.$inferInsert)['type']; file: string; title: string }> = [
  { type: 'TOS', file: 'terms.md', title: 'Пользовательское соглашение' },
  { type: 'OFFER', file: 'offer.md', title: 'Оферта на оказание услуг' },
  { type: 'PRIVACY', file: 'privacy.md', title: 'Политика обработки персональных данных' },
  { type: 'PD_CONSENT_USER', file: 'pd-consent.md', title: 'Согласие на обработку персональных данных' },
  { type: 'PARTICIPANT_CONSENT_TEMPLATE', file: 'participant-consent-template.md', title: 'Согласие участника (шаблон)' },
  { type: 'DPA', file: 'dpa.md', title: 'Условия поручения обработки персональных данных' },
  { type: 'CONTENT_RULES', file: 'content-rules.md', title: 'Правила допустимого контента' },
  { type: 'COOKIES', file: 'cookies.md', title: 'Политика использования файлов cookie' },
  { type: 'MARKETING', file: 'marketing.md', title: 'Согласие на получение рекламных сообщений' },
  { type: 'COMPLAINTS', file: 'complaints.md', title: 'Порядок рассмотрения жалоб и заявлений правообладателей' },
  { type: 'CONTACTS', file: 'contacts.md', title: 'Контакты и реквизиты' },
  { type: 'PARTICIPANT_NOTICE', file: 'participant-notice.md', title: 'Уведомление участника' },
];

// From compiled dist/auth/ → up 4 levels to repo root → legal/
const LEGAL_DIR = resolve(fileURLToPath(new URL('../../../../legal', import.meta.url)));

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function generateId(): string {
  return createHash('sha256').update(Math.random().toString() + Date.now()).digest('hex').slice(0, 24);
}

@Injectable()
export class LegalDocumentService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** A-02: ensures draft versions of required legal documents exist in the DB on startup. */
  async onModuleInit(): Promise<void> {
    // Skip seeding when using a stub DB (tests that don't pass a real DB).
    if (typeof (this.db as unknown as Record<string, unknown>)['select'] !== 'function') return;
    for (const { type, file, title } of DRAFT_DOCS) {
      const filePath = resolve(LEGAL_DIR, file);
      if (!existsSync(filePath)) continue;
      const bodyMd = readFileSync(filePath, 'utf8');
      const contentSha256 = sha256(bodyMd);

      const existing = await this.db
        .select({ id: schema.legalDocuments.id, contentSha256: schema.legalDocuments.contentSha256 })
        .from(schema.legalDocuments)
        .where(eq(schema.legalDocuments.type, type))
        .limit(1);

      if (existing[0]) {
        if (existing[0].contentSha256 === contentSha256) continue;
        // Content changed: insert new version (higher than existing max).
        const currentVersion = await this.db
          .select({ version: schema.legalDocuments.version })
          .from(schema.legalDocuments)
          .where(eq(schema.legalDocuments.type, type))
          .orderBy(desc(schema.legalDocuments.version))
          .limit(1);
        const nextVersion = (currentVersion[0]?.version ?? 0) + 1;
        await this.db.insert(schema.legalDocuments).values({ id: generateId(), type, version: nextVersion, title, bodyMd, contentSha256 });
      } else {
        await this.db.insert(schema.legalDocuments).values({ id: generateId(), type, version: 1, title, bodyMd, contentSha256 });
      }
    }
  }

  /** A-02: returns the latest version of the document by type, or null if not found. */
  async getLatest(type: (typeof schema.legalDocuments.$inferInsert)['type']): Promise<typeof schema.legalDocuments.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.legalDocuments)
      .where(eq(schema.legalDocuments.type, type))
      .orderBy(desc(schema.legalDocuments.version))
      .limit(1);
    return rows[0] ?? null;
  }

  /** AD-06: returns all versions of the document by type, newest first. */
  async getVersions(type: (typeof schema.legalDocuments.$inferInsert)['type']): Promise<(typeof schema.legalDocuments.$inferSelect)[]> {
    return this.db
      .select()
      .from(schema.legalDocuments)
      .where(eq(schema.legalDocuments.type, type))
      .orderBy(desc(schema.legalDocuments.version));
  }
}
