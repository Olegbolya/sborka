CREATE TYPE "public"."access_point_kind" AS ENUM('LINK', 'QR');--> statement-breakpoint
CREATE TYPE "public"."answer_source" AS ENUM('QUESTION', 'VARIABLE', 'ACTION');--> statement-breakpoint
CREATE TYPE "public"."asset_license" AS ENUM('OWN', 'OFL', 'CC0', 'MIT', 'APACHE', 'CC_BY', 'LICENSED');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('PHONE', 'VK', 'YANDEX');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('NEW', 'IN_PROGRESS', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."consent_subject_type" AS ENUM('USER', 'PARTICIPANT', 'REPORTER');--> statement-breakpoint
CREATE TYPE "public"."copyright_claim_status" AS ENUM('NEW', 'CLARIFY_REQUESTED', 'REMOVED', 'REJECTED_WITH_PROOF');--> statement-breakpoint
CREATE TYPE "public"."data_request_kind" AS ENUM('ACCESS', 'DELETE', 'WITHDRAW');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('PHONE', 'TABLET', 'DESKTOP', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."legal_document_type" AS ENUM('TOS', 'OFFER', 'PRIVACY', 'PD_CONSENT_USER', 'DPA', 'COOKIES', 'CONTENT_RULES', 'MARKETING', 'COMPLAINTS', 'CONTACTS', 'PARTICIPANT_NOTICE', 'PARTICIPANT_CONSENT_TEMPLATE');--> statement-breakpoint
CREATE TYPE "public"."library_kind" AS ENUM('STICKERS', 'REACTIONS', 'BACKGROUNDS', 'SOUNDS', 'FONTS', 'ANIMATIONS');--> statement-breakpoint
CREATE TYPE "public"."limit_kind" AS ENUM('STARTS', 'COMPLETIONS');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('IMAGE', 'GIF', 'VIDEO', 'AUDIO', 'LOTTIE', 'FONT_SOURCE');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('UPLOADED', 'PROCESSING', 'READY', 'REJECTED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."moderation_action_kind" AS ENUM('WARN', 'UNPUBLISH', 'BLOCK_PROJECT', 'BLOCK_MEDIA', 'BLOCK_USER', 'LEGAL_HOLD', 'RELEASE_HOLD', 'RESTORE');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('NONE', 'PENDING', 'APPROVED', 'FLAGGED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."moderation_target" AS ENUM('PROJECT', 'MEDIA', 'USER', 'THEME', 'TEMPLATE', 'LIBRARY_ITEM', 'FONT');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('SUBSCRIPTION', 'PASS', 'ADDON');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PAID', 'CANCELED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payer_type" AS ENUM('PERSON', 'BUSINESS');--> statement-breakpoint
CREATE TYPE "public"."play_event_type" AS ENUM('SCREEN_VIEW', 'ACTION', 'LINK_OUT', 'RULE_LIMIT');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('DRAFT', 'PUBLISHED', 'CLOSED', 'BLOCKED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."renew_mode" AS ENUM('AUTO', 'LINK');--> statement-breakpoint
CREATE TYPE "public"."report_priority" AS ENUM('P0', 'P1', 'P2');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."participant_session_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."subscription_period" AS ENUM('MONTH', 'YEAR');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'MODERATOR', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'BLOCKED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."version_kind" AS ENUM('DRAFT_SNAPSHOT', 'PUBLISHED');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_e164" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" text,
	"ua_family" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_e164" text,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"age_confirmed_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"totp_secret_enc" text,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" "consent_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"legal_document_id" text,
	"kind" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"ip_hash" text,
	"ua_family" text,
	"evidence" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "legal_document_type" NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"content_sha256" text NOT NULL,
	"published_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"family" text NOT NULL,
	"styles" jsonb NOT NULL,
	"has_cyrillic" boolean NOT NULL,
	"license" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "library_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "library_kind" NOT NULL,
	"title" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"media_id" text,
	"font_id" text,
	"title" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"license" "asset_license" NOT NULL,
	"author" text NOT NULL,
	"source" text NOT NULL,
	"attribution" text,
	"rights_confirmed_by_id" text NOT NULL,
	"rights_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdraw_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_one_asset_ck" CHECK (("library_items"."media_id" IS NOT NULL) <> ("library_items"."font_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"kind" "media_kind" NOT NULL,
	"status" "media_status" DEFAULT 'UPLOADED' NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"sha256" text NOT NULL,
	"phash" text,
	"palette" jsonb,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moderation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_elements" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"cover_media_id" text,
	"fragment" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"category" text,
	"cover_media_id" text,
	"document" jsonb NOT NULL,
	"source_project_id" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"cover_media_id" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access_points" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" "access_point_kind" DEFAULT 'LINK' NOT NULL,
	"label" text NOT NULL,
	"qr_style" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"sha256" text NOT NULL,
	"kind" "version_kind" NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "project_status" DEFAULT 'DRAFT' NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'NONE' NOT NULL,
	"age_rating" integer,
	"is_advertising" boolean DEFAULT false NOT NULL,
	"ad_marking" jsonb,
	"operator_info" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme_id" text,
	"draft_version_id" text,
	"published_version_id" text,
	"published_at" timestamp with time zone,
	"closed_reason" text,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"screen_id" text,
	"block_id" text,
	"variable_id" text,
	"source" "answer_source" NOT NULL,
	"value" jsonb NOT NULL,
	"device_reported" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"time_on_screen_ms" integer
);
--> statement-breakpoint
CREATE TABLE "limit_counters" (
	"project_id" text NOT NULL,
	"kind" "limit_kind" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "limit_counters_project_id_kind_pk" PRIMARY KEY("project_id","kind")
);
--> statement-breakpoint
CREATE TABLE "participant_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version_id" text NOT NULL,
	"access_point_id" text,
	"status" "participant_session_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_token_hash" text,
	"ip_hash" text,
	"device_type" "device_type" DEFAULT 'UNKNOWN' NOT NULL,
	"score" integer,
	"result_key" text,
	"duration_ms" integer,
	"runtime_state" jsonb,
	"is_preview" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" "play_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stats_daily" (
	"project_id" text NOT NULL,
	"day" date NOT NULL,
	"access_point_id" text DEFAULT '' NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"starts" integer DEFAULT 0 NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"avg_duration_ms" integer,
	CONSTRAINT "project_stats_daily_project_id_day_access_point_id_pk" PRIMARY KEY("project_id","day","access_point_id")
);
--> statement-breakpoint
CREATE TABLE "random_draws" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"source_id" text NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"project_id" text,
	"feature" text NOT NULL,
	"quantity" integer,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"source_order_id" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"kind" "order_kind" NOT NULL,
	"item" jsonb NOT NULL,
	"amount_kop" integer NOT NULL,
	"payer_type" "payer_type" DEFAULT 'PERSON' NOT NULL,
	"payer_inn" text,
	"status" "order_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"price_month_rub" integer,
	"price_year_rub" integer,
	"price_once_rub" integer,
	"limits" jsonb NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"period" "subscription_period" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"renew_mode" "renew_mode" DEFAULT 'LINK' NOT NULL,
	"auto_renew_consent_id" text,
	"payment_method_ref" text,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_monthly" (
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"sms_sent" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_monthly_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"ip_hash" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authority_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"number" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "case_status" DEFAULT 'NEW' NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "copyright_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"claimant" jsonb NOT NULL,
	"object_description" text NOT NULL,
	"urls" text[] NOT NULL,
	"statement" jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "copyright_claim_status" DEFAULT 'NEW' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clarify_requested_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "data_request_kind" NOT NULL,
	"subject_contact" text NOT NULL,
	"project_id" text,
	"details" text NOT NULL,
	"status" "case_status" DEFAULT 'NEW' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" text NOT NULL,
	"action" "moderation_action_kind" NOT NULL,
	"reason_code" text NOT NULL,
	"note" text NOT NULL,
	"actor_id" text NOT NULL,
	"report_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"media_id" text,
	"snapshot_version_id" text,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"reporter_contact" text,
	"reporter_ip_hash" text,
	"priority" "report_priority" NOT NULL,
	"status" "report_status" DEFAULT 'NEW' NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonts" ADD CONSTRAINT "fonts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_collection_id_library_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."library_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_font_id_fonts_id_fk" FOREIGN KEY ("font_id") REFERENCES "public"."fonts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_rights_confirmed_by_id_users_id_fk" FOREIGN KEY ("rights_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_elements" ADD CONSTRAINT "saved_elements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_elements" ADD CONSTRAINT "saved_elements_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_points" ADD CONSTRAINT "access_points_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_draft_version_id_project_versions_id_fk" FOREIGN KEY ("draft_version_id") REFERENCES "public"."project_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_published_version_id_project_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."project_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_participant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."participant_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_counters" ADD CONSTRAINT "limit_counters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_version_id_project_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."project_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_access_point_id_access_points_id_fk" FOREIGN KEY ("access_point_id") REFERENCES "public"."access_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_events" ADD CONSTRAINT "play_events_session_id_participant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."participant_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stats_daily" ADD CONSTRAINT "project_stats_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_draws" ADD CONSTRAINT "random_draws_session_id_participant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."participant_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_auto_renew_consent_id_consent_records_id_fk" FOREIGN KEY ("auto_renew_consent_id") REFERENCES "public"."consent_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_monthly" ADD CONSTRAINT "usage_monthly_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copyright_claims" ADD CONSTRAINT "copyright_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_snapshot_version_id_project_versions_id_fk" FOREIGN KEY ("snapshot_version_id") REFERENCES "public"."project_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_uq" ON "auth_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_phone_created_idx" ON "otp_requests" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE INDEX "otp_ip_created_idx" ON "otp_requests" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consent_subject_idx" ON "consent_records" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_type_version_uq" ON "legal_documents" USING btree ("type","version");--> statement-breakpoint
CREATE INDEX "fonts_owner_idx" ON "fonts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "library_items_collection_idx" ON "library_items" USING btree ("collection_id","active");--> statement-breakpoint
CREATE INDEX "library_items_tags_idx" ON "library_items" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "media_owner_created_idx" ON "media" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_sha256_idx" ON "media" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "media_phash_idx" ON "media" USING btree ("phash");--> statement-breakpoint
CREATE INDEX "saved_elements_owner_idx" ON "saved_elements" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "templates_owner_idx" ON "templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "templates_system_idx" ON "templates" USING btree ("is_system","category","sort");--> statement-breakpoint
CREATE INDEX "themes_owner_idx" ON "themes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "themes_system_idx" ON "themes" USING btree ("is_system","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_points_code_uq" ON "access_points" USING btree ("code");--> statement-breakpoint
CREATE INDEX "access_points_project_idx" ON "access_points" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_versions_number_uq" ON "project_versions" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "project_versions_kind_idx" ON "project_versions" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_uq" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "projects_owner_status_idx" ON "projects" USING btree ("owner_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "projects_deleted_idx" ON "projects" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_session_block_uq" ON "answers" USING btree ("session_id","block_id") WHERE "answers"."block_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_session_variable_uq" ON "answers" USING btree ("session_id","variable_id") WHERE "answers"."variable_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "psessions_project_started_idx" ON "participant_sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "psessions_project_status_idx" ON "participant_sessions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "psessions_device_idx" ON "participant_sessions" USING btree ("project_id","device_token_hash");--> statement-breakpoint
CREATE INDEX "psessions_access_point_idx" ON "participant_sessions" USING btree ("access_point_id");--> statement-breakpoint
CREATE INDEX "play_events_session_at_idx" ON "play_events" USING btree ("session_id","at");--> statement-breakpoint
CREATE INDEX "play_events_at_idx" ON "play_events" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "random_draws_uq" ON "random_draws" USING btree ("session_id","source_id","seq");--> statement-breakpoint
CREATE INDEX "entitlements_user_idx" ON "entitlements" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "entitlements_project_idx" ON "entitlements" USING btree ("project_id","feature");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_payment_uq" ON "orders" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_paid_idx" ON "orders" USING btree ("status","paid_at");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "authority_requests_due_idx" ON "authority_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "copyright_claims_status_due_idx" ON "copyright_claims" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "data_subject_requests_due_idx" ON "data_subject_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_status_due_idx" ON "reports" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "reports_project_idx" ON "reports" USING btree ("project_id");