CREATE TYPE "public"."rating_outcome" AS ENUM('rated', 'cancelled', 'unclear', 'timeout');--> statement-breakpoint
ALTER TYPE "public"."agent_turn_kind" ADD VALUE 'rating_prompt';--> statement-breakpoint
CREATE TABLE "interaction_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"asked_offset_ms" integer NOT NULL,
	"answered_offset_ms" integer,
	"ended_offset_ms" integer NOT NULL,
	"rating" integer,
	"outcome" "rating_outcome" NOT NULL,
	"agent_turn_id" uuid,
	"config_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interaction_rating" ADD CONSTRAINT "interaction_rating_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_rating" ADD CONSTRAINT "interaction_rating_agent_turn_id_agent_turn_id_fk" FOREIGN KEY ("agent_turn_id") REFERENCES "public"."agent_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interaction_rating_session_offset_idx" ON "interaction_rating" USING btree ("capture_session_id","asked_offset_ms");