ALTER TABLE "templates" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "example_project_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_template_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_slug_uq" ON "templates" USING btree ("slug") WHERE "templates"."slug" IS NOT NULL AND "templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "templates_example_idx" ON "templates" USING btree ("example_project_id");--> statement-breakpoint
CREATE INDEX "projects_source_label_idx" ON "projects" USING btree ("source_label");--> statement-breakpoint
CREATE INDEX "projects_source_template_idx" ON "projects" USING btree ("source_template_id");