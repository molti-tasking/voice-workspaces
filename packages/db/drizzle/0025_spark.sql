CREATE TYPE "public"."recall_provenance" AS ENUM('mine', 'souffleur', 'both', 'unsure');--> statement-breakpoint
CREATE TYPE "public"."spark_kind" AS ENUM('say_back', 'decide', 'unsure', 'revisit');--> statement-breakpoint
CREATE TABLE "drive_subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"first_offset_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_subject_segment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_subject_id" uuid NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"end_offset_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_probe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"drive_subject_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"confidence" integer,
	"self_accuracy" integer,
	"provenance" "recall_provenance",
	"delay_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject_signal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_subject_id" uuid NOT NULL,
	"user_words" integer NOT NULL,
	"agent_words" integer NOT NULL,
	"pauses" integer NOT NULL,
	"pauses_before" integer DEFAULT 0 NOT NULL,
	"fillers" integer NOT NULL,
	"self_repairs" integer NOT NULL,
	"hedges" integer NOT NULL,
	"settled" boolean,
	"fade" real NOT NULL,
	"sparks_shown" "spark_kind"[] DEFAULT '{}' NOT NULL,
	"sparks_pulled" "spark_kind"[] DEFAULT '{}' NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"signals_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "spark_kind" "spark_kind";--> statement-breakpoint
ALTER TABLE "drive_subject" ADD CONSTRAINT "drive_subject_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_subject_segment" ADD CONSTRAINT "drive_subject_segment_drive_subject_id_drive_subject_id_fk" FOREIGN KEY ("drive_subject_id") REFERENCES "public"."drive_subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_probe" ADD CONSTRAINT "recall_probe_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_probe" ADD CONSTRAINT "recall_probe_drive_subject_id_drive_subject_id_fk" FOREIGN KEY ("drive_subject_id") REFERENCES "public"."drive_subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_signal" ADD CONSTRAINT "subject_signal_drive_subject_id_drive_subject_id_fk" FOREIGN KEY ("drive_subject_id") REFERENCES "public"."drive_subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_subject_session_ordinal_uq" ON "drive_subject" USING btree ("capture_session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_subject_segment_uq" ON "drive_subject_segment" USING btree ("drive_subject_id","start_offset_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "recall_probe_subject_uq" ON "recall_probe" USING btree ("drive_subject_id");--> statement-breakpoint
CREATE INDEX "recall_probe_user_due_idx" ON "recall_probe" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_signal_subject_uq" ON "subject_signal" USING btree ("drive_subject_id");