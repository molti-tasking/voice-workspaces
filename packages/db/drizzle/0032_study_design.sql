CREATE TYPE "public"."study_design_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TABLE "study_design" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"views" jsonb NOT NULL,
	"tasks" jsonb NOT NULL,
	"status" "study_design_status" DEFAULT 'draft' NOT NULL,
	"completion_code" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "study_design_name_uq" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "study_session" ALTER COLUMN "design" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "study_session" ADD COLUMN "prolific_study_id" text;--> statement-breakpoint
ALTER TABLE "study_session" ADD COLUMN "prolific_session_id" text;--> statement-breakpoint
ALTER TABLE "study_session" ADD COLUMN "test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "study_design_one_active_uq" ON "study_design" USING btree ("status") WHERE "study_design"."status" = 'active';--> statement-breakpoint
-- Session-2's setup, the one every session was made in until now, as the active one.
INSERT INTO "study_design" ("name", "views", "tasks", "status", "activated_at", "note")
VALUES ('between', '["chat","topics","uptake"]', '["trip","birthday"]', 'active', now(), 'Session-2: the chat, the topic line and the topic line with uptake, over two tasks.');--> statement-breakpoint
-- Any other name sessions are filed under (session-1's "within"), closed, with the views and tasks they had.
INSERT INTO "study_design" ("name", "views", "tasks", "status", "created_at", "closed_at", "note")
SELECT s."design",
  coalesce(jsonb_agg(DISTINCT b."display") FILTER (WHERE b."display" IS NOT NULL), '[]'::jsonb),
  coalesce(jsonb_agg(DISTINCT b."task") FILTER (WHERE b."task" IS NOT NULL), '[]'::jsonb),
  'closed', min(s."created_at"), now(), 'Made from the sessions filed under it before setups existed.'
FROM "study_session" s LEFT JOIN "study_block" b ON b."session_id" = s."id"
WHERE s."design" <> 'between'
GROUP BY s."design";--> statement-breakpoint
-- Sessions a researcher made to try the study, by the ref they were told to give them.
UPDATE "study_session" SET "test" = true WHERE "ref" LIKE 'TEST%';--> statement-breakpoint
ALTER TABLE "study_session" ADD CONSTRAINT "study_session_design_study_design_name_fk" FOREIGN KEY ("design") REFERENCES "public"."study_design"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_session_design_idx" ON "study_session" USING btree ("design");