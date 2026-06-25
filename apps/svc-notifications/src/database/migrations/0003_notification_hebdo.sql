CREATE TABLE "notification_hebdo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contrat_id" uuid NOT NULL,
	"foyer_id" uuid NOT NULL,
	"semaine_iso" varchar(8) NOT NULL,
	"type" varchar(32) NOT NULL,
	"statut" varchar(32) NOT NULL,
	"notifiee_le" timestamp with time zone DEFAULT now() NOT NULL,
	"validee_le" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"delta_modifs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_hebdo_contrat_semaine_type_uq" UNIQUE("contrat_id","semaine_iso","type")
);
