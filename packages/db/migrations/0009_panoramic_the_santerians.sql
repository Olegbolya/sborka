CREATE TABLE "media_blocked_hashes" (
	"id" text PRIMARY KEY NOT NULL,
	"phash" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"added_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_blocked_hashes_phash_unique" UNIQUE("phash")
);
--> statement-breakpoint
CREATE INDEX "media_blocked_hashes_phash_idx" ON "media_blocked_hashes" USING btree ("phash");