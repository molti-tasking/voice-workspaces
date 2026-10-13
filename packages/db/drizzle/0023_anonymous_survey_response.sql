CREATE TABLE "anonymous_survey_response" (
	"id" uuid PRIMARY KEY NOT NULL,
	"survey" text NOT NULL,
	"version" text NOT NULL,
	"answers" jsonb NOT NULL,
	"submitted_on" date NOT NULL
);
--> statement-breakpoint
CREATE INDEX "anonymous_survey_response_survey_idx" ON "anonymous_survey_response" USING btree ("survey");