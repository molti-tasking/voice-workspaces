CREATE TYPE "public"."keep_via" AS ENUM('tap', 'voice');--> statement-breakpoint
ALTER TABLE "subject_signal" ADD COLUMN "kept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subject_signal" ADD COLUMN "kept_via" "keep_via";--> statement-breakpoint
ALTER TABLE "subject_signal" ADD COLUMN "kept_at" timestamp with time zone;