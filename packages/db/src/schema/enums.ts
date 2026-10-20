import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['USER', 'MODERATOR', 'ADMIN']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'BLOCKED', 'DELETED']);
export const authProvider = pgEnum('auth_provider', ['PHONE', 'VK', 'YANDEX']);

export const legalDocumentType = pgEnum('legal_document_type', [
  'TOS',
  'OFFER',
  'PRIVACY',
  'PD_CONSENT_USER',
  'DPA',
  'COOKIES',
  'CONTENT_RULES',
  'MARKETING',
  'COMPLAINTS',
  'CONTACTS',
  'PARTICIPANT_NOTICE',
  'PARTICIPANT_CONSENT_TEMPLATE',
]);
export const consentSubjectType = pgEnum('consent_subject_type', ['USER', 'PARTICIPANT', 'REPORTER']);

export const projectStatus = pgEnum('project_status', ['DRAFT', 'PUBLISHED', 'CLOSED', 'BLOCKED', 'DELETED']);
export const moderationStatus = pgEnum('moderation_status', ['NONE', 'PENDING', 'APPROVED', 'FLAGGED', 'BLOCKED']);
export const versionKind = pgEnum('version_kind', ['DRAFT_SNAPSHOT', 'PUBLISHED']);

export const mediaKind = pgEnum('media_kind', ['IMAGE', 'GIF', 'VIDEO', 'AUDIO', 'LOTTIE', 'FONT_SOURCE']);
export const mediaStatus = pgEnum('media_status', ['UPLOADED', 'PROCESSING', 'READY', 'REJECTED', 'BLOCKED']);
export const libraryKind = pgEnum('library_kind', ['STICKERS', 'REACTIONS', 'BACKGROUNDS', 'SOUNDS', 'FONTS', 'ANIMATIONS']);
export const assetLicense = pgEnum('asset_license', ['OWN', 'OFL', 'CC0', 'MIT', 'APACHE', 'CC_BY', 'LICENSED']);

export const accessPointKind = pgEnum('access_point_kind', ['LINK', 'QR']);
export const sessionStatus = pgEnum('participant_session_status', ['IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'REJECTED']);
export const deviceType = pgEnum('device_type', ['PHONE', 'TABLET', 'DESKTOP', 'UNKNOWN']);
export const answerSource = pgEnum('answer_source', ['QUESTION', 'VARIABLE', 'ACTION']);
export const playEventType = pgEnum('play_event_type', ['SCREEN_VIEW', 'ACTION', 'LINK_OUT', 'RULE_LIMIT']);
export const limitKind = pgEnum('limit_kind', ['STARTS', 'COMPLETIONS']);

export const subscriptionPeriod = pgEnum('subscription_period', ['MONTH', 'YEAR']);
export const subscriptionStatus = pgEnum('subscription_status', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED']);
export const renewMode = pgEnum('renew_mode', ['AUTO', 'LINK']);
export const orderKind = pgEnum('order_kind', ['SUBSCRIPTION', 'PASS', 'ADDON']);
export const orderStatus = pgEnum('order_status', ['PENDING', 'PAID', 'CANCELED', 'REFUNDED']);
export const payerType = pgEnum('payer_type', ['PERSON', 'BUSINESS']);

export const reportPriority = pgEnum('report_priority', ['P0', 'P1', 'P2']);
export const reportStatus = pgEnum('report_status', ['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED']);
export const copyrightClaimStatus = pgEnum('copyright_claim_status', [
  'NEW',
  'CLARIFY_REQUESTED',
  'REMOVED',
  'REJECTED_WITH_PROOF',
]);
export const moderationTarget = pgEnum('moderation_target', [
  'PROJECT',
  'MEDIA',
  'USER',
  'THEME',
  'TEMPLATE',
  'LIBRARY_ITEM',
  'FONT',
]);
export const moderationActionKind = pgEnum('moderation_action_kind', [
  'WARN',
  'UNPUBLISH',
  'BLOCK_PROJECT',
  'BLOCK_MEDIA',
  'BLOCK_USER',
  'LEGAL_HOLD',
  'RELEASE_HOLD',
  'RESTORE',
]);
export const dataRequestKind = pgEnum('data_request_kind', ['ACCESS', 'DELETE', 'WITHDRAW']);
export const caseStatus = pgEnum('case_status', ['NEW', 'IN_PROGRESS', 'CLOSED']);
