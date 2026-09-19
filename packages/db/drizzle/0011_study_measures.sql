CREATE TYPE "public"."agent_decision_outcome" AS ENUM('spoke', 'declined', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."agent_decision_trigger" AS ENUM('user_turn', 'opening', 'silence_offer', 'confirmation', 'macro_offer', 'agenda');--> statement-breakpoint
CREATE TABLE "agent_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"offset_ms" integer NOT NULL,
	"trigger" "agent_decision_trigger" NOT NULL,
	"outcome" "agent_decision_outcome" NOT NULL,
	"config_version" text,
	"latency_ms" integer,
	"subject_key" text,
	"agent_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "study_condition" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "study_participant_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "study_condition" jsonb;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_agent_turn_id_agent_turn_id_fk" FOREIGN KEY ("agent_turn_id") REFERENCES "public"."agent_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decision_session_offset_idx" ON "agent_decision" USING btree ("capture_session_id","offset_ms");--> statement-breakpoint
CREATE INDEX "agent_decision_session_subject_idx" ON "agent_decision" USING btree ("capture_session_id","subject_key") WHERE "agent_decision"."subject_key" is not null;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_study_participant_id_unique" UNIQUE("study_participant_id");
