-- AD-08: the audit log is append-only. Any UPDATE or DELETE is rejected by the database itself.
CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Журнал аудита нельзя изменять или удалять (AD-08)' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
