import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { schema } from '@blokum/db';
import { CurrentUser, Public } from './decorators.js';
import type { RequestUser } from './session.service.js';
import { ConsentService, type PendingDocument } from './consent.service.js';
import { LegalDocumentService } from './legal-document.service.js';

const VALID_DOC_TYPES = new Set(schema.legalDocuments.type.enumValues);

class RecordConsentsDto {
  documentIds!: string[];
  ageConfirmed!: boolean;
  marketingConsentDocId?: string;
}

interface OnboardingStatus {
  completed: boolean;
  pending: PendingDocument[];
}

interface DocumentResponse {
  id: string;
  type: string;
  version: number;
  title: string;
  bodyMd: string;
  isDraft: boolean;
}

/** A-02: consent and onboarding endpoints. */
@Controller('auth/onboarding')
export class ConsentController {
  constructor(
    private readonly consent: ConsentService,
    private readonly legalDocs: LegalDocumentService,
  ) {}

  /** A-02: returns onboarding status — which required consents are pending. */
  @Get()
  async status(@CurrentUser() user: RequestUser): Promise<OnboardingStatus> {
    const pending = await this.consent.getPendingConsents(user.id);
    return { completed: pending.length === 0, pending };
  }

  /** A-02: records consents for the given document IDs. */
  @Post('consent')
  @HttpCode(200)
  async recordConsents(@Body() body: RecordConsentsDto, @CurrentUser() user: RequestUser, @Req() req: Request): Promise<{ ok: true }> {
    if (!Array.isArray(body.documentIds)) {
      throw new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'documentIds должен быть массивом' } });
    }
    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';
    const ua = req.headers['user-agent'] ?? '';
    await this.consent.recordConsents(user.id, {
      documentIds: body.documentIds,
      ageConfirmed: body.ageConfirmed ?? false,
      marketingConsentDocId: body.marketingConsentDocId,
      ip,
      ua,
    });
    return { ok: true };
  }
}

/** A-02, D1/D4/D9: public document retrieval endpoint — no auth required. */
@Public()
@Controller('legal/documents')
export class LegalController {
  constructor(private readonly legalDocs: LegalDocumentService) {}

  /** Returns the latest version of a legal document by type slug (e.g. tos, pd-consent-user, marketing). */
  @Get(':type')
  async getDocument(@Param('type') typeSlug: string): Promise<DocumentResponse> {
    const type = typeSlug.toUpperCase().replace(/-/g, '_') as Parameters<LegalDocumentService['getLatest']>[0];
    if (!VALID_DOC_TYPES.has(type)) {
      throw new BadRequestException({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Документ не найден' } });
    }
    const doc = await this.legalDocs.getLatest(type);
    if (!doc) {
      throw new BadRequestException({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Документ не найден' } });
    }
    return { id: doc.id, type: doc.type, version: doc.version, title: doc.title, bodyMd: doc.bodyMd, isDraft: !doc.publishedAt };
  }

  /** AD-06: returns all versions of a legal document by type slug, newest first. */
  @Get(':type/versions')
  async getVersions(@Param('type') typeSlug: string): Promise<DocumentResponse[]> {
    const type = typeSlug.toUpperCase().replace(/-/g, '_') as Parameters<LegalDocumentService['getLatest']>[0];
    if (!VALID_DOC_TYPES.has(type)) {
      throw new BadRequestException({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Документ не найден' } });
    }
    const docs = await this.legalDocs.getVersions(type);
    return docs.map((doc) => ({ id: doc.id, type: doc.type, version: doc.version, title: doc.title, bodyMd: doc.bodyMd, isDraft: !doc.publishedAt }));
  }
}
