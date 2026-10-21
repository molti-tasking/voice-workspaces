CREATE TYPE "public"."study_moment_kind" AS ENUM('esm', 'game', 'probe', 'resume');--> statement-breakpoint
CREATE TABLE "study_moment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"kind" "study_moment_kind" NOT NULL,
	"ordinal" integer NOT NULL,
	"item" text NOT NULL,
	"shown_offset_ms" integer NOT NULL,
	"answered_offset_ms" integer,
	"value" integer,
	"text" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_moment" ADD CONSTRAINT "study_moment_block_id_study_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."study_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_moment" ADD CONSTRAINT "study_moment_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_moment_once_uq" ON "study_moment" USING btree ("capture_session_id","kind","ordinal");--> statement-breakpoint
CREATE INDEX "study_moment_block_idx" ON "study_moment" USING btree ("block_id");