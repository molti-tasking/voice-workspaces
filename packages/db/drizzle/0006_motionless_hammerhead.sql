CREATE TABLE "agent_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"responding_to_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_draft" ADD CONSTRAINT "agent_draft_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_draft_session_seq_idx" ON "agent_draft" USING btree ("capture_session_id","seq");--> statement-breakpoint
CREATE INDEX "agent_draft_session_idx" ON "agent_draft" USING btree ("capture_session_id");