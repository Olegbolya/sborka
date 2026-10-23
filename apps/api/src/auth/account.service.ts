import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { DB, EMAIL_SENDER } from '../tokens.js';
import { type ApiConfig } from '../config.js';
import { API_CONFIG } from '../tokens.js';
import type { EmailSender } from './email-sender.js';
import { TotpService } from './totp.service.js';
import { AuditLogService } from './audit-log.service.js';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_GRACE_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export interface UserProfile {
  id: string;
  displayName: string;
  phoneE164: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: string;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ipHash: string | null;
  uaFamily: string | null;
  isCurrent: boolean;
}

export interface ConsentSummary {
  id: string;
  kind: string;
  documentType: string | null;
  documentVersion: number | null;
  acceptedAt: Date;
  withdrawnAt: Date | null;
}

export interface ExportData {
  exportedAt: string;
  profile: UserProfile;
  authIdentities: Array<{ provider: string; createdAt: Date }>;
  sessions: SessionSummary[];
  consentHistory: ConsentSummary[];
}

@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    private readonly totpSvc: TotpService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** A-03, D-10: return full user profile. */
  async getProfile(userId: string): Promise<UserProfile> {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const user = rows[0];
    if (!user) throw new NotFoundException();
    return {
      id: user.id,
      displayName: user.displayName,
      phoneE164: user.phoneE164 ?? null,
      email: user.email ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt ?? null,
    };
  }

  /** D-10: update displayName. */
  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    const name = displayName.trim();
    if (!name || name.length > 100) {
      throw new BadRequestException({ error: { code: 'INVALID_INPUT', message: 'Имя должно быть от 1 до 100 символов' } });
    }
    await this.db.update(schema.users).set({ displayName: name }).where(eq(schema.users.id, userId));
  }

  /** A-03: request email change — sends verification link. */
  async requestEmailVerification(userId: string, email: string): Promise<void> {
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      throw new BadRequestException({ error: { code: 'INVALID_EMAIL', message: 'Некорректный email' } });
    }

    const existing = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, emailNorm), isNull(schema.users.deletedAt)))
      .limit(1);
    if (existing[0] && existing[0].id !== userId) {
      throw new ConflictException({ error: { code: 'EMAIL_TAKEN', message: 'Email уже используется' } });
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

    await this.db.insert(schema.emailVerificationTokens).values({
      userId,
      email: emailNorm,
      tokenHash,
      expiresAt,
    });

    const verifyUrl = `${this.config.webUrl}/auth/email/verify?token=${token}`;
    await this.emailSender.sendVerification(emailNorm, verifyUrl);
  }

  /** A-03: verify email via token from link. */
  async verifyEmail(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const rows = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);
    const record = rows[0];
    if (!record) throw new BadRequestException({ error: { code: 'INVALID_TOKEN', message: 'Ссылка недействительна' } });
    if (record.usedAt) throw new BadRequestException({ error: { code: 'TOKEN_USED', message: 'Ссылка уже использована' } });
    if (record.expiresAt < new Date()) throw new BadRequestException({ error: { code: 'TOKEN_EXPIRED', message: 'Ссылка истекла' } });

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.emailVerificationTokens.id, record.id));
      await tx
        .update(schema.users)
        .set({ email: record.email, emailVerifiedAt: new Date() })
        .where(eq(schema.users.id, record.userId));
    });
  }

  /** D-10: list active sessions. */
  async getSessions(userId: string, currentTokenHash: string): Promise<SessionSummary[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, userId),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.sessions.lastSeenAt));

    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      ipHash: s.ipHash ?? null,
      uaFamily: s.uaFamily ?? null,
      isCurrent: s.tokenHash === currentTokenHash,
    }));
  }

  /** D-10: consent history including withdrawal status. */
  async getConsentHistory(userId: string): Promise<ConsentSummary[]> {
    const rows = await this.db
      .select({
        id: schema.consentRecords.id,
        kind: schema.consentRecords.kind,
        acceptedAt: schema.consentRecords.acceptedAt,
        withdrawnAt: schema.consentRecords.withdrawnAt,
        docType: schema.legalDocuments.type,
        docVersion: schema.legalDocuments.version,
      })
      .from(schema.consentRecords)
      .leftJoin(schema.legalDocuments, eq(schema.consentRecords.legalDocumentId, schema.legalDocuments.id))
      .where(and(eq(schema.consentRecords.subjectType, 'USER'), eq(schema.consentRecords.subjectId, userId)))
      .orderBy(desc(schema.consentRecords.acceptedAt));

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      documentType: r.docType ?? null,
      documentVersion: r.docVersion ?? null,
      acceptedAt: r.acceptedAt,
      withdrawnAt: r.withdrawnAt ?? null,
    }));
  }

  /** D-10: revoke marketing consent (A-02 optional consent withdrawal). */
  async revokeMarketingConsent(userId: string): Promise<void> {
    await this.db
      .update(schema.consentRecords)
      .set({ withdrawnAt: new Date() })
      .where(
        and(
          eq(schema.consentRecords.subjectType, 'USER'),
          eq(schema.consentRecords.subjectId, userId),
          eq(schema.consentRecords.kind, 'marketing_consent'),
          isNull(schema.consentRecords.withdrawnAt),
        ),
      );
  }

  /** D-10: export all user data as a JSON object. */
  async exportData(userId: string, currentTokenHash: string): Promise<ExportData> {
    const profile = await this.getProfile(userId);
    const sessions = await this.getSessions(userId, currentTokenHash);
    const consentHistory = await this.getConsentHistory(userId);

    const identities = await this.db
      .select({ provider: schema.authIdentities.provider, createdAt: schema.authIdentities.createdAt })
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, userId));

    return {
      exportedAt: new Date().toISOString(),
      profile,
      authIdentities: identities,
      sessions: sessions.map((s) => ({ ...s, isCurrent: undefined }) as unknown as SessionSummary),
      consentHistory,
    };
  }

  /** A-05: soft-delete user account. Projects are closed immediately; sessions stay valid for 30-day restoration. */
  async deleteAccount(userId: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ status: 'DELETED', deletedAt: now })
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));

      // Close all published/draft projects immediately (A-05: сборки снимаются сразу).
      await tx
        .update(schema.projects)
        .set({ status: 'CLOSED', deletedAt: now })
        .where(
          and(
            eq(schema.projects.ownerId, userId),
            isNull(schema.projects.deletedAt),
            or(eq(schema.projects.status, 'PUBLISHED'), eq(schema.projects.status, 'DRAFT')),
          ),
        );
      // Sessions are kept valid during the 30-day grace period so the user can restore without logging in again.
    });
  }

  /** A-05: restore account within 30-day grace period. */
  async restoreAccount(userId: string): Promise<void> {
    const rows = await this.db
      .select({ deletedAt: schema.users.deletedAt, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) throw new NotFoundException();
    if (user.status !== 'DELETED' || !user.deletedAt) {
      throw new ForbiddenException({ error: { code: 'NOT_DELETED', message: 'Аккаунт не удалён' } });
    }
    const graceCutoff = new Date(user.deletedAt.getTime() + DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() > graceCutoff) {
      throw new ForbiddenException({ error: { code: 'GRACE_PERIOD_EXPIRED', message: 'Срок восстановления истёк' } });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ status: 'ACTIVE', deletedAt: null })
        .where(eq(schema.users.id, userId));

      await tx
        .update(schema.projects)
        .set({ status: 'DRAFT', deletedAt: null })
        .where(and(eq(schema.projects.ownerId, userId), eq(schema.projects.status, 'CLOSED')));
    });
  }

  /** AD-01: initiate TOTP setup — generates and encrypts secret, returns QR URI. */
  async setupTotp(userId: string): Promise<{ totpUri: string }> {
    const rows = await this.db.select({ phoneE164: schema.users.phoneE164, totpSecretEnc: schema.users.totpSecretEnc }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const user = rows[0];
    if (!user) throw new NotFoundException();
    if (user.totpSecretEnc) {
      throw new ConflictException({ error: { code: 'TOTP_ALREADY_ENABLED', message: 'TOTP уже настроен' } });
    }
    const secret = this.totpSvc.generateSecret();
    const encrypted = this.totpSvc.encryptSecret(secret);
    await this.db.update(schema.users).set({ totpSecretEnc: encrypted }).where(eq(schema.users.id, userId));
    const uri = this.totpSvc.totpUri(encrypted, user.phoneE164 ?? userId);
    await this.auditLog.log({ actorId: userId, action: 'TOTP_SETUP_INITIATED', targetType: 'user', targetId: userId });
    return { totpUri: uri };
  }

  /** AD-01: confirm TOTP with first code — activates 2FA and returns one-time backup codes. */
  async confirmTotp(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const rows = await this.db.select({ totpSecretEnc: schema.users.totpSecretEnc }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const user = rows[0];
    if (!user || !user.totpSecretEnc) {
      throw new BadRequestException({ error: { code: 'TOTP_NOT_SETUP', message: 'Сначала выполните настройку TOTP' } });
    }
    if (!this.totpSvc.verifyTotpCode(user.totpSecretEnc, code)) {
      throw new BadRequestException({ error: { code: 'INVALID_TOTP', message: 'Неверный код TOTP' } });
    }
    const pairs = this.totpSvc.generateBackupCodes();
    await this.totpSvc.storeBackupCodes(userId, pairs.map((p) => p.hash));
    await this.auditLog.log({ actorId: userId, action: 'TOTP_CONFIRMED', targetType: 'user', targetId: userId });
    return { backupCodes: pairs.map((p) => p.code) };
  }

  /** AD-01: disable TOTP for the user (removes secret and backup codes). */
  async disableTotp(userId: string, ip?: string): Promise<void> {
    const rows = await this.db.select({ totpSecretEnc: schema.users.totpSecretEnc }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!rows[0]?.totpSecretEnc) {
      throw new BadRequestException({ error: { code: 'TOTP_NOT_ENABLED', message: 'TOTP не настроен' } });
    }
    await this.totpSvc.revokeTotp(userId);
    await this.auditLog.log({ actorId: userId, action: 'TOTP_DISABLED', targetType: 'user', targetId: userId, ip });
  }
}
