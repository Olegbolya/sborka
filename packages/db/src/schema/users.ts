import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './columns.js';
import { authProvider, userRole, userStatus } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: id(),
    phoneE164: text('phone_e164'),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull().default('USER'),
    status: userStatus('status').notNull().default('ACTIVE'),
    ageConfirmedAt: ts('age_confirmed_at'),
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    email: text('email'),
    emailVerifiedAt: ts('email_verified_at'),
    totpSecretEnc: text('totp_secret_enc'),
    legalHold: boolean('legal_hold').notNull().default(false),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('users_phone_uq').on(t.phoneE164), index('users_status_idx').on(t.status)],
);

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_identities_provider_uq').on(t.provider, t.providerUserId), index('auth_identities_user_idx').on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    ipHash: text('ip_hash'),
    uaFamily: text('ua_family'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

/** A-03: email verification tokens (one-time-use, 24 h TTL). */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_verif_token_uq').on(t.tokenHash), index('email_verif_user_idx').on(t.userId)],
);

/** AD-01: backup codes for TOTP 2FA (one-time use, stored as SHA-256 hashes). */
export const totpBackupCodes = pgTable(
  'totp_backup_codes',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('totp_backup_user_idx').on(t.userId)],
);

export const otpRequests = pgTable(
  'otp_requests',
  {
    id: id(),
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('otp_phone_created_idx').on(t.phoneE164, t.createdAt), index('otp_ip_created_idx').on(t.ipHash, t.createdAt)],
);

/** AD-01 · login and password of an administrator or a moderator (the second factor stays the authenticator code). The password is kept only as a scrypt hash. */
export const adminCredentials = pgTable('admin_credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  login: text('login').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Wrong passwords in a row; set back to 0 by a right one. */
  failedCount: integer('failed_count').notNull().default(0),
  /** The door is shut until this time after too many wrong passwords. */
  lockedUntil: ts('locked_until'),
  /** How many times in a row the door was shut: every next shutting lasts twice as long. */
  lockLevel: integer('lock_level').notNull().default(0),
  createdAt: createdAt(),
  passwordChangedAt: ts('password_changed_at'),
});
