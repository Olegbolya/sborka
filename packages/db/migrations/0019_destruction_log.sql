CREATE TABLE "destruction_log" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	"basis" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "destruction_log_created_idx" ON "destruction_log" USING btree ("created_at");--> statement-breakpoint
-- P8.8 · 05-LEGAL.md §5: the audit log is kept three years. It stays append-only (AD-08): a row may be removed only when it
-- is older than three years; an UPDATE and a TRUNCATE are rejected as before.
CREATE OR REPLACE FUNCTION audit_log_reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.created_at < now() - interval '3 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Журнал аудита нельзя изменять или удалять (AD-08)' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
DROP TRIGGER audit_log_no_delete ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_reject_delete();
