CREATE TYPE "public"."floor_event_kind" AS ENUM('open', 'locked', 'poke');--> statement-breakpoint
ALTER TYPE "public"."agent_decision_trigger" ADD VALUE 'poke';--> statement-breakpoint
CREATE TABLE "floor_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"offset_ms" integer NOT NULL,
	"kind" "floor_event_kind" NOT NULL,
	"at_connect" boolean DEFAULT false NOT NULL,
	"config_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "forced_poke" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "floor_event" ADD CONSTRAINT "floor_event_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floor_event_session_offset_idx" ON "floor_event" USING btree ("capture_session_id","offset_ms");