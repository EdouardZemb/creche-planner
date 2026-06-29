CREATE TABLE "etablissement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"nom" varchar(200) NOT NULL,
	"email_service" varchar(320),
	"preavis_regle" jsonb,
	"types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adresse" varchar(500),
	"telephone" varchar(40),
	"contact" varchar(200),
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etablissement_foyer_nom_uq" UNIQUE("foyer_id","nom")
);