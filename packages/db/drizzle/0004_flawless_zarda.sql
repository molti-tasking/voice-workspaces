CREATE TYPE "public"."capture_setting" AS ENUM('driving', 'walking', 'hands_busy', 'desk');--> statement-breakpoint
CREATE TYPE "public"."macro_proposal_status" AS ENUM('proposed', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "directive" (
	"utterance_id" uuid PRIMARY KEY NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"object" text DEFAULT '' NOT NULL,
	"restatement" text NOT NULL,
	"capability_id" uuid,
	"confidence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"canonical_form" text NOT NULL,
	"occurrences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"proposed_name" text NOT NULL,
	"restatement" text NOT NULL,
	"markdown" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"replay_artifact_id" uuid,
	"status" "macro_proposal_status" DEFAULT 'proposed' NOT NULL,
	"decided_at" timestamp with time zone,
	"capability_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "setting" "capture_setting";--> statement-breakpoint
ALTER TABLE "directive" ADD CONSTRAINT "directive_utterance_id_utterance_id_fk" FOREIGN KEY ("utterance_id") REFERENCES "public"."utterance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive" ADD CONSTRAINT "directive_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive" ADD CONSTRAINT "directive_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_proposal" ADD CONSTRAINT "macro_proposal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_proposal" ADD CONSTRAINT "macro_proposal_replay_artifact_id_artifact_id_fk" FOREIGN KEY ("replay_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_proposal" ADD CONSTRAINT "macro_proposal_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directive_session_created_idx" ON "directive" USING btree ("capture_session_id","created_at");--> statement-breakpoint
CREATE INDEX "directive_unresolved_idx" ON "directive" USING btree ("created_at") WHERE "directive"."capability_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "macro_proposal_user_form_idx" ON "macro_proposal" USING btree ("user_id","canonical_form");--> statement-breakpoint
CREATE INDEX "macro_proposal_user_status_idx" ON "macro_proposal" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "utterance_unclassified_idx" ON "utterance" USING btree ("chunk_id") WHERE "utterance"."kind" = 'unclassified';