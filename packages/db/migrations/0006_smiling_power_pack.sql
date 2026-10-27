ALTER TABLE "themes" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;