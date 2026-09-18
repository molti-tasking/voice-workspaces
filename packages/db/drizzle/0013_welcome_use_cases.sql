CREATE TYPE "public"."capture_use_case" AS ENUM('think_aloud', 'draft', 'recall');--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "board_enabled_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "use_case" "capture_use_case";--> statement-breakpoint
-- Give the board to everybody who already has an account.
--
-- The DEFAULT above only helps people who sign up from here on. Without this,
-- the peers who tried the system last week — the ones who reported it as "an
-- organizer for voice memos", because the agent had no board to act on — would
-- still be the only accounts without one.
--
-- `now()` rather than their `created_at`: this is the date the board was
-- granted, and back-dating it would put board activity before the grant in any
-- analysis that joins the two. Guarded on NULL so a re-run cannot move a date
-- that is already recorded, and so a researcher who deliberately nulls a row
-- for a future phase design is not overruled by the next deploy.
UPDATE "user" SET "board_enabled_at" = now() WHERE "board_enabled_at" IS NULL;
