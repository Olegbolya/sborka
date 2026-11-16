CREATE TABLE "choice_releases" (
	"session_id" text NOT NULL,
	"option_id" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "choice_releases_session_id_option_id_pk" PRIMARY KEY("session_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "choice_releases" ADD CONSTRAINT "choice_releases_session_id_participant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."participant_sessions"("id") ON DELETE cascade ON UPDATE no action;