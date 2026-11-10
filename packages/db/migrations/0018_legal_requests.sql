ALTER TABLE "copyright_claims" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD COLUMN "extended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD COLUMN "extension_reason" text;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD COLUMN "ip_hash" text;