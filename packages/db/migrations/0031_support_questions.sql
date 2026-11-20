CREATE TYPE "public"."support_question_status" AS ENUM('NEW', 'ANSWERED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "support_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"status" "support_question_status" DEFAULT 'NEW' NOT NULL,
	"answer" text,
	"answered_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "support_questions" ADD CONSTRAINT "support_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_questions_status_idx" ON "support_questions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_questions_user_idx" ON "support_questions" USING btree ("user_id","created_at");