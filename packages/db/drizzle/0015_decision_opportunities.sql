ALTER TABLE "agent_decision" ADD COLUMN "opportunity_seq" integer;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_decision_session_opportunity_idx" ON "agent_decision" USING btree ("capture_session_id","opportunity_seq","attempt");