CREATE TABLE "foyer_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"date_effet" varchar(10) NOT NULL,
	"ressources_mensuelles_centimes" integer DEFAULT 0 NOT NULL,
	"rfr_centimes" integer DEFAULT 0 NOT NULL,
	"tranche" integer NOT NULL,
	"nb_enfants_a_charge" integer DEFAULT 0 NOT NULL,
	"nb_parts" numeric DEFAULT '0' NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foyer_version_foyer_date_uq" UNIQUE("foyer_id","date_effet")
);
