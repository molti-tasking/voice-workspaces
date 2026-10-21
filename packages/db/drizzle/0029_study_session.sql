CREATE TYPE "public"."study_session_source" AS ENUM('invite', 'prolific');--> statement-breakpoint
CREATE TABLE "study_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"display" text NOT NULL,
	"task" text NOT NULL,
	"capture_session_id" uuid,
	"armed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" text,
	"answers" jsonb,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"source" "study_session_source" DEFAULT 'invite' NOT NULL,
	"invite_code" text,
	"prolific_pid" text,
	"user_id" text,
	"design" text DEFAULT 'within' NOT NULL,
	"order_index" integer NOT NULL,
	"claimed_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"final" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_block" ADD CONSTRAINT "study_block_session_id_study_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_block" ADD CONSTRAINT "study_block_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_session" ADD CONSTRAINT "study_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_block_position_uq" ON "study_block" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "study_block_capture_uq" ON "study_block" USING btree ("capture_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_session_ref_uq" ON "study_session" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "study_session_invite_uq" ON "study_session" USING btree ("invite_code");--> statement-breakpoint
CREATE UNIQUE INDEX "study_session_pid_uq" ON "study_session" USING btree ("prolific_pid");--> statement-breakpoint
CREATE INDEX "study_session_user_idx" ON "study_session" USING btree ("user_id");