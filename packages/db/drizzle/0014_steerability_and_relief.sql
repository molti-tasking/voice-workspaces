CREATE TYPE "public"."study_event_kind" AS ENUM('board_open', 'card_open');--> statement-breakpoint
CREATE TYPE "public"."study_item_outcome" AS ENUM('done', 'open', 'lost');--> statement-breakpoint
CREATE TYPE "public"."study_response_phase" AS ENUM('pre', 'post', 'day7');--> statement-breakpoint
ALTER TYPE "public"."agent_decision_trigger" ADD VALUE 'answer';--> statement-breakpoint
ALTER TYPE "public"."agent_turn_kind" ADD VALUE 'filler';--> statement-breakpoint
CREATE TABLE "study_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "study_event_kind" NOT NULL,
	"card_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_item_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"capture_session_id" uuid,
	"outcome" "study_item_outcome" NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"capture_session_id" uuid,
	"phase" "study_response_phase" NOT NULL,
	"item" text NOT NULL,
	"value" integer NOT NULL,
	"scale_max" integer DEFAULT 7 NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "cue_id" text;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "authoritative" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_turn" ADD COLUMN "end_measured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "setting_source" text;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "debrief_started_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "debrief_ended_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "study_event" ADD CONSTRAINT "study_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_item_review" ADD CONSTRAINT "study_item_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_item_review" ADD CONSTRAINT "study_item_review_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_response" ADD CONSTRAINT "study_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_response" ADD CONSTRAINT "study_response_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_event_user_at_idx" ON "study_event" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "study_event_user_card_idx" ON "study_event" USING btree ("user_id","card_id") WHERE "study_event"."card_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "study_item_review_user_card_idx" ON "study_item_review" USING btree ("user_id","card_id");--> statement-breakpoint
CREATE INDEX "study_item_review_user_at_idx" ON "study_item_review" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "study_response_session_phase_item_idx" ON "study_response" USING btree ("user_id","capture_session_id","phase","item");--> statement-breakpoint
CREATE INDEX "study_response_user_at_idx" ON "study_response" USING btree ("user_id","responded_at");--> statement-breakpoint
CREATE INDEX "agent_decision_session_cue_idx" ON "agent_decision" USING btree ("capture_session_id","cue_id") WHERE "agent_decision"."cue_id" is not null;