CREATE TABLE "comms_meta_log" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"project_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sender_ip_hash" text,
	"sender_device" text,
	"bytes" integer NOT NULL,
	"content_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comms_meta_created_idx" ON "comms_meta_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comms_meta_project_idx" ON "comms_meta_log" USING btree ("project_id","created_at");