import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './columns.js';
import { orderKind, orderStatus, payerType, renewMode, subscriptionPeriod, subscriptionStatus } from './enums.js';
import { projects } from './projects.js';
import { users } from './users.js';
import { consentRecords } from './legal.js';

/** Limits and feature flags of a plan; keys are documented in docs/04-TARIFFS.md §6. `null` = no limit. */
export interface PlanLimits {
  publishedProjects: number | null;
  completionsPerMonth: number;
  completionsScope: 'account' | 'project';
  screensPerProject: number;
  ownThemes: number | null;
  ownFonts: boolean;
  rulesPerProject: number;
  behaviors: 'all' | string[];
  movingObjects: number;
  mediaTransitionsPerProject: number | null;
  premiumTransitions: boolean;
  ownTemplates: number | null;
  ownElements: number | null;
  audio: boolean;
  watermark: boolean;
  customSlug: boolean;
  styledQr: boolean;
  accessPointsPerProject: number | null;
  accessControls: boolean;
  contactsCollection: boolean;
  storageBytes: number;
  maxImageBytes: number;
  maxGifBytes: number;
  maxVideoBytes: number;
  maxVideoSeconds: number;
  maxVideoHeight: number;
  answersRetentionDays: number;
  exportFormats: Array<'csv' | 'xlsx'>;
  notifications: 'daily' | 'instant' | 'instant_plus';
  versionHistoryDays: number;
  ownBranding: boolean;
  allowIndexing: boolean;
  directExternalLinks: boolean;
  invoicePayment: boolean;
  supportHours: number | null;
  passDays?: number;
  /** Free trial of a subscription in days, no card needed (ADR-048). */
  trialDays?: number;
}

export const plans = pgTable('plans', {
  code: text('code').primaryKey(),
  title: text('title').notNull(),
  priceMonthRub: integer('price_month_rub'),
  priceYearRub: integer('price_year_rub'),
  priceOnceRub: integer('price_once_rub'),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  public: boolean('public').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

/** P7.5 · an extra purchase (docs/04-TARIFFS.md §3): the price and the size live here, so the owner changes them in the admin without a release. */
export const addons = pgTable('addons', {
  code: text('code').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  priceRub: integer('price_rub').notNull(),
  /** The effect of one purchase, read by the payment when it is confirmed. */
  params: jsonb('params').$type<AddonParams>().notNull(),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export type AddonEffect = 'PASS_COMPLETIONS' | 'SUBSCRIPTION_COMPLETIONS' | 'SUBSCRIPTION_STORAGE' | 'PASS_EXTEND' | 'FREE_EXTRAS';

export interface AddonParams {
  effect: AddonEffect;
  /** How many passages (completions) or bytes of storage one purchase gives. */
  quantity?: number;
  /** For how long the purchase acts; `null` or missing = forever (PASS_EXTEND uses `days`, the others `months`). */
  months?: number;
  days?: number;
  themes?: number;
  rules?: number;
}

export type PromoKind = 'PERCENT' | 'FIXED' | 'FREE_PASS';

/** P7.5 · promo codes (AD-05): a percent off, a fixed sum off, or a free pass «Праздник»; with a limit of uses and a term. */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: id(),
    code: text('code').notNull(),
    kind: text('kind').$type<PromoKind>().notNull(),
    /** Percent (1–99) for PERCENT, roubles for FIXED, unused for FREE_PASS. */
    value: integer('value').notNull().default(0),
    /** The kinds of order the code works for: `SUBSCRIPTION`, `PASS`, `ADDON`. */
    appliesTo: jsonb('applies_to').$type<string[]>().notNull(),
    maxActivations: integer('max_activations'),
    activations: integer('activations').notNull().default(0),
    validFrom: ts('valid_from'),
    validTo: ts('valid_to'),
    active: boolean('active').notNull().default(true),
    note: text('note').notNull().default(''),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('promo_codes_code_uq').on(t.code)],
);

/** One use of a code by one person: a code works once for a person. The row is released when the order is not paid. */
export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: id(),
    promoId: text('promo_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('promo_redemptions_person_uq').on(t.promoId, t.userId), index('promo_redemptions_order_idx').on(t.orderId)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code, { onDelete: 'restrict' }),
    period: subscriptionPeriod('period').notNull(),
    status: subscriptionStatus('status').notNull(),
    currentPeriodStart: ts('current_period_start').notNull(),
    currentPeriodEnd: ts('current_period_end').notNull(),
    renewMode: renewMode('renew_mode').notNull().default('LINK'),
    autoRenewConsentId: text('auto_renew_consent_id').references(() => consentRecords.id, { onDelete: 'set null' }),
    paymentMethodRef: text('payment_method_ref'),
    canceledAt: ts('canceled_at'),
    /** Пробный период без карты (ADR-048): один на человека, признак остаётся, даже когда подписка закончилась или оплачена. */
    trial: boolean('trial').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('subscriptions_user_status_idx').on(t.userId, t.status)],
);

/** Orders are kept for accounting (5 years) even after the user is deleted, hence `set null`. */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: orderKind('kind').notNull(),
    item: jsonb('item').$type<Record<string, unknown>>().notNull(),
    amountKop: integer('amount_kop').notNull(),
    payerType: payerType('payer_type').notNull().default('PERSON'),
    payerInn: text('payer_inn'),
    status: orderStatus('status').notNull().default('PENDING'),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id'),
    receipt: jsonb('receipt').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    paidAt: ts('paid_at'),
    refundedAt: ts('refunded_at'),
  },
  (t) => [
    uniqueIndex('orders_provider_payment_uq').on(t.provider, t.providerPaymentId),
    index('orders_user_created_idx').on(t.userId, t.createdAt),
    index('orders_paid_idx').on(t.status, t.paidAt),
  ],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    quantity: integer('quantity'),
    validFrom: ts('valid_from').notNull().defaultNow(),
    validTo: ts('valid_to'),
    sourceOrderId: text('source_order_id').references(() => orders.id, { onDelete: 'set null' }),
  },
  (t) => [index('entitlements_user_idx').on(t.userId, t.feature), index('entitlements_project_idx').on(t.projectId, t.feature)],
);

export const usageMonthly = pgTable(
  'usage_monthly',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    completions: integer('completions').notNull().default(0),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    smsSent: integer('sms_sent').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] })],
);
