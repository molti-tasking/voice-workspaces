CREATE TYPE "public"."memory_kind" AS ENUM('passage', 'topic');--> statement-breakpoint
CREATE TABLE "memory_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"ref_id" text NOT NULL,
	"capture_session_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" vector NOT NULL,
	"utterance_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "memory_indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_entry" ADD CONSTRAINT "memory_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry" ADD CONSTRAINT "memory_entry_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entry_user_kind_ref_idx" ON "memory_entry" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "memory_entry_user_kind_model_idx" ON "memory_entry" USING btree ("user_id","kind","model");--> statement-breakpoint
CREATE INDEX "memory_entry_session_idx" ON "memory_entry" USING btree ("capture_session_id");