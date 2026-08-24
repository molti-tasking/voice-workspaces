CREATE TYPE "public"."agent_turn_kind" AS ENUM('reply', 'proactive_prompt', 'confirmation_request', 'backchannel');--> statement-breakpoint
CREATE TABLE "agent_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"end_offset_ms" integer NOT NULL,
	"kind" "agent_turn_kind" DEFAULT 'reply' NOT NULL,
	"responding_to_text" text,
	"text" text NOT NULL,
	"generated_text" text NOT NULL,
	"truncated_at_ms" integer,
	"barged_in" boolean DEFAULT false NOT NULL,
	"mode_version_id" uuid,
	"persona_version_id" uuid,
	"requested_model" text,
	"resolved_model" text,
	"asr_ms" integer,
	"ttft_ms" integer,
	"speak_ttfb_ms" integer,
	"total_latency_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config_version" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_turn" ADD CONSTRAINT "agent_turn_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turn" ADD CONSTRAINT "agent_turn_mode_version_id_capability_version_id_fk" FOREIGN KEY ("mode_version_id") REFERENCES "public"."capability_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turn" ADD CONSTRAINT "agent_turn_persona_version_id_capability_version_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."capability_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_turn_session_seq_idx" ON "agent_turn" USING btree ("capture_session_id","seq");--> statement-breakpoint
CREATE INDEX "agent_turn_session_offset_idx" ON "agent_turn" USING btree ("capture_session_id","start_offset_ms");