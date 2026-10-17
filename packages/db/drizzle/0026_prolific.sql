CREATE TYPE "public"."prolific_arm" AS ENUM('control', 'sparks');--> statement-breakpoint
CREATE TABLE "prolific_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prolific_pid" text NOT NULL,
	"user_id" text NOT NULL,
	"arm" "prolific_arm" NOT NULL,
	"task" text NOT NULL,
	"recall_delay_hours" integer NOT NULL,
	"part1_study_id" text,
	"part1_session_id" text,
	"consented_at" timestamp with time zone NOT NULL,
	"capture_session_id" uuid,
	"part1_completed_at" timestamp with time zone,
	"judgment_of_learning" integer,
	"part2_study_id" text,
	"part2_session_id" text,
	"part2_started_at" timestamp with time zone,
	"free_recall" text,
	"free_recall_at" timestamp with time zone,
	"free_recall_confidence" integer,
	"closing" jsonb,
	"part2_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prolific_participant" ADD CONSTRAINT "prolific_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prolific_participant" ADD CONSTRAINT "prolific_participant_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prolific_participant_pid_uq" ON "prolific_participant" USING btree ("prolific_pid");--> statement-breakpoint
CREATE INDEX "prolific_participant_user_idx" ON "prolific_participant" USING btree ("user_id");