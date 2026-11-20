-- AD-13: every question becomes a chat — its text is the first message of the person, its answer the first reply of support.
INSERT INTO "support_messages" ("id", "question_id", "author", "author_id", "text", "created_at")
SELECT substr(md5(random()::text || q."id" || 'u'), 1, 16), q."id", 'USER', q."user_id", q."text", q."created_at" FROM "support_questions" q;--> statement-breakpoint
INSERT INTO "support_messages" ("id", "question_id", "author", "author_id", "text", "created_at")
SELECT substr(md5(random()::text || q."id" || 's'), 1, 16), q."id", 'SUPPORT', q."answered_by_id", q."answer", coalesce(q."answered_at", q."created_at") FROM "support_questions" q WHERE q."answer" IS NOT NULL;--> statement-breakpoint
UPDATE "support_questions" SET "last_message_at" = coalesce("answered_at", "created_at");--> statement-breakpoint
ALTER TABLE "support_questions" DROP COLUMN "answer";