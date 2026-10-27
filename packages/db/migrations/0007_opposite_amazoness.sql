ALTER TABLE "answers" ADD COLUMN "client_event_id" text;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "client_ts" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_session_event_uq" ON "answers" USING btree ("session_id","client_event_id") WHERE "answers"."client_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "psessions_ip_started_idx" ON "participant_sessions" USING btree ("ip_hash","started_at");