CREATE TYPE "public"."support_author" AS ENUM('USER', 'SUPPORT');--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"author" "support_author" NOT NULL,
	"author_id" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_questions" ADD COLUMN "last_message_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_question_id_support_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."support_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_messages_question_idx" ON "support_messages" USING btree ("question_id","created_at");