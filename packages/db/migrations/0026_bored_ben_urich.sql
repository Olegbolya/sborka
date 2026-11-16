CREATE TABLE "board_hidden" (
	"project_id" text NOT NULL,
	"row_key" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_hidden_project_id_row_key_pk" PRIMARY KEY("project_id","row_key")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"project_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"group_by" text DEFAULT 'participants' NOT NULL,
	"metric" text DEFAULT 'score' NOT NULL,
	"metric_variable_id" text,
	"aggregate" text DEFAULT 'sum' NOT NULL,
	"team_block_id" text,
	"nick_block_id" text,
	"consent_block_id" text,
	"show_on_finish" boolean DEFAULT true NOT NULL,
	"frozen_at" timestamp with time zone,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_hidden" ADD CONSTRAINT "board_hidden_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boards_code_uq" ON "boards" USING btree ("code");