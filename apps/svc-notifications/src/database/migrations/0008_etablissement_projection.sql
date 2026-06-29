CREATE TABLE "etablissement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"nom" varchar(200) NOT NULL,
	"email_service" varchar(320),
	"preavis_regle" jsonb,
	"types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contrat" ADD COLUMN "etablissement_id" uuid;