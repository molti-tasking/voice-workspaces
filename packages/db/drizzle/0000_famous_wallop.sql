CREATE TYPE "public"."capability_origin_kind" AS ENUM('starter', 'crystallisation', 'reflexive');--> statement-breakpoint
CREATE TYPE "public"."capability_type" AS ENUM('mode', 'persona', 'action', 'rule');--> statement-breakpoint
CREATE TYPE "public"."chunk_status" AS ENUM('stored', 'transcribing', 'transcribed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."utterance_kind" AS ENUM('content', 'directive', 'unclassified');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"produced_by_invocation_id" uuid,
	"kind" text NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" "chunk_status" DEFAULT 'stored' NOT NULL,
	"failure_reason" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transcribed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "capability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "capability_type" NOT NULL,
	"name" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_origin" (
	"capability_id" uuid PRIMARY KEY NOT NULL,
	"created_via" "capability_origin_kind" NOT NULL,
	"triggering_session_id" uuid,
	"triggering_start_offset_ms" integer,
	"triggering_end_offset_ms" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"markdown" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"restatement" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"active_mode_id" uuid,
	"active_persona_id" uuid,
	"device_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone,
	"external_ref" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" uuid NOT NULL,
	"capability_version_id" uuid NOT NULL,
	"capture_session_id" uuid,
	"triggering_utterance_id" uuid,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed" boolean,
	"reverted" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "outlet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "utterance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_session_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"end_offset_ms" integer NOT NULL,
	"text" text NOT NULL,
	"kind" "utterance_kind" DEFAULT 'unclassified' NOT NULL,
	"kind_override" "utterance_kind",
	"kind_confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_produced_by_invocation_id_invocation_id_fk" FOREIGN KEY ("produced_by_invocation_id") REFERENCES "public"."invocation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_chunk" ADD CONSTRAINT "audio_chunk_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability" ADD CONSTRAINT "capability_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_origin" ADD CONSTRAINT "capability_origin_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_origin" ADD CONSTRAINT "capability_origin_triggering_session_id_capture_session_id_fk" FOREIGN KEY ("triggering_session_id") REFERENCES "public"."capture_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_version" ADD CONSTRAINT "capability_version_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_session" ADD CONSTRAINT "capture_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_delivery" ADD CONSTRAINT "export_delivery_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_delivery" ADD CONSTRAINT "export_delivery_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocation" ADD CONSTRAINT "invocation_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocation" ADD CONSTRAINT "invocation_capability_version_id_capability_version_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocation" ADD CONSTRAINT "invocation_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocation" ADD CONSTRAINT "invocation_triggering_utterance_id_utterance_id_fk" FOREIGN KEY ("triggering_utterance_id") REFERENCES "public"."utterance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet" ADD CONSTRAINT "outlet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterance" ADD CONSTRAINT "utterance_capture_session_id_capture_session_id_fk" FOREIGN KEY ("capture_session_id") REFERENCES "public"."capture_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterance" ADD CONSTRAINT "utterance_chunk_id_audio_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."audio_chunk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artifact_session_idx" ON "artifact" USING btree ("capture_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_chunk_session_seq_idx" ON "audio_chunk" USING btree ("capture_session_id","seq");--> statement-breakpoint
CREATE INDEX "audio_chunk_status_idx" ON "audio_chunk" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_user_name_idx" ON "capability" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "capability_user_type_idx" ON "capability" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_version_unique_idx" ON "capability_version" USING btree ("capability_id","version");--> statement-breakpoint
CREATE INDEX "capability_version_created_idx" ON "capability_version" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "capture_session_user_started_idx" ON "capture_session" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "export_delivery_artifact_idx" ON "export_delivery" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "invocation_capability_fired_idx" ON "invocation" USING btree ("capability_id","fired_at");--> statement-breakpoint
CREATE INDEX "invocation_session_idx" ON "invocation" USING btree ("capture_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outlet_user_name_idx" ON "outlet" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "utterance_session_offset_idx" ON "utterance" USING btree ("capture_session_id","start_offset_ms");--> statement-breakpoint
CREATE INDEX "utterance_kind_idx" ON "utterance" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");