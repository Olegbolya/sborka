CREATE TABLE "blocked_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_identities_kind_hash_idx" ON "blocked_identities" USING btree ("kind","hash");--> statement-breakpoint
CREATE INDEX "blocked_identities_user_idx" ON "blocked_identities" USING btree ("user_id");