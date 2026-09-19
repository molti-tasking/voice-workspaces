CREATE TYPE "public"."agent_draft_author" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TABLE "agent_draft_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"major" integer NOT NULL,
	"minor" integer NOT NULL,
	"author" "agent_draft_author" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"restored_from_version_id" uuid,
	"responding_to_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_draft_version" ADD CONSTRAINT "agent_draft_version_draft_id_agent_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_draft_version" ADD CONSTRAINT "agent_draft_version_restored_from_version_id_agent_draft_version_id_fk" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."agent_draft_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_draft_version_number_idx" ON "agent_draft_version" USING btree ("draft_id","major","minor");--> statement-breakpoint
CREATE INDEX "agent_draft_version_draft_idx" ON "agent_draft_version" USING btree ("draft_id");--> statement-breakpoint
-- Give every draft already in the ledger its v1.0.
--
-- Without this, every reader moves to `agent_draft_version` and the whole
-- history of the study disappears from `/sessions/[id]` on deploy — the rows
-- are all still in `agent_draft`, but nothing looks at those columns any more.
-- The agent wrote them, so they are v1.0 by `agent`, and `created_at` is
-- carried across rather than defaulted so a backfilled version is not dated
-- the migration.
--
-- The NOT EXISTS guard makes this safe to run again: `0002_shocking_trauma.sql`
-- set the precedent for a hand-written statement after the generated ones, and
-- a backfill that cannot be re-run is one a failed deploy turns into a manual
-- repair job.
INSERT INTO "agent_draft_version" ("draft_id","major","minor","author","title","text","responding_to_text","created_at")
SELECT d."id",1,0,'agent',d."title",d."text",d."responding_to_text",d."created_at" FROM "agent_draft" d
WHERE NOT EXISTS (SELECT 1 FROM "agent_draft_version" v WHERE v."draft_id"=d."id");
