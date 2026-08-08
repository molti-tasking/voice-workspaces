CREATE TYPE "public"."workspace_op_type" AS ENUM('create_topic', 'rename_topic', 'merge_topics', 'add_block', 'revise_block', 'retire_block', 'move_block');--> statement-breakpoint
CREATE TABLE "extraction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"requested_model" text NOT NULL,
	"resolved_model" text NOT NULL,
	"temperature" text NOT NULL,
	"seed" integer,
	"input_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state_digest" text NOT NULL,
	"request_messages" jsonb NOT NULL,
	"raw_response" text NOT NULL,
	"parse_error" text,
	"parse_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_cursor" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_utterance_id" uuid,
	"last_occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_op" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"extraction_id" uuid,
	"seq" bigserial NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"capture_session_id" uuid,
	"type" "workspace_op_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"source_utterance_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction" ADD CONSTRAINT "extraction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cursor" ADD CONSTRAINT "workspace_cursor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_op" ADD CONSTRAINT "workspace_op_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_op" ADD CONSTRAINT "workspace_op_extraction_id_extraction_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extraction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_op" ADD CONSTRAINT "workspace_op_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_user_input_hash_idx" ON "extraction" USING btree ("user_id","input_hash");--> statement-breakpoint
CREATE INDEX "extraction_user_created_idx" ON "extraction" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_op_user_seq_idx" ON "workspace_op" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "workspace_op_user_occurred_idx" ON "workspace_op" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "workspace_op_session_idx" ON "workspace_op" USING btree ("capture_session_id");