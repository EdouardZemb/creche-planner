ALTER TABLE "contrat" ADD COLUMN "enfant_id" uuid;--> statement-breakpoint
CREATE TABLE "processed_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stream" varchar(32) NOT NULL,
	"type" varchar(200) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
