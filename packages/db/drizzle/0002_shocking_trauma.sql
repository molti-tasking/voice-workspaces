ALTER TABLE "capture_session" ADD COLUMN "ended_by" text;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "analytics_emitted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "capture_session_analytics_pending_idx" ON "capture_session" USING btree ("ended_at") WHERE "capture_session"."analytics_emitted_at" is null;--> statement-breakpoint
-- Mark every drive that already finished as reported.
--
-- Without this the first sweep after deploy would treat the entire history as
-- newly complete and emit one capture_session_completed per drive at once,
-- landing as a spike on the deploy date rather than as the study's real
-- activity curve. The rows are untouched in Postgres, so a deliberate backfill
-- with correct historical timestamps is still possible later.
UPDATE "capture_session" SET "analytics_emitted_at" = now() WHERE "ended_at" IS NOT NULL;