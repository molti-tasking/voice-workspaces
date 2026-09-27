CREATE TYPE "public"."agent_draft_curation_action" AS ENUM('archive', 'restore');--> statement-breakpoint
CREATE TABLE "agent_draft_curation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"action" "agent_draft_curation_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_draft" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "agent_draft_curation" ADD CONSTRAINT "agent_draft_curation_draft_id_agent_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_draft_curation_draft_idx" ON "agent_draft_curation" USING btree ("draft_id","created_at");