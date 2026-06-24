CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stream" varchar(32) NOT NULL,
	"type" varchar(200) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
