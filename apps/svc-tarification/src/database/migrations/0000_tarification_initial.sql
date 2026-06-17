CREATE TABLE "enfant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"prenom" varchar(200) NOT NULL,
	"date_naissance" varchar(10) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foyer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ressources_mensuelles_centimes" integer DEFAULT 0 NOT NULL,
	"rfr_centimes" integer DEFAULT 0 NOT NULL,
	"tranche" integer NOT NULL,
	"nb_parts" numeric DEFAULT '0' NOT NULL,
	"nb_enfants_a_charge" integer DEFAULT 0 NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grille_tarifaire" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(32) NOT NULL,
	"tranche" integer,
	"valide_du" varchar(10) NOT NULL,
	"valide_au" varchar(10),
	"parametres" jsonb NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grille_tarifaire_mode_tranche_du_uq" UNIQUE("mode","tranche","valide_du")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prestation_mois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrat_id" uuid NOT NULL,
	"foyer_id" uuid NOT NULL,
	"enfant" varchar(200) NOT NULL,
	"mode" varchar(32) NOT NULL,
	"mois" varchar(7) NOT NULL,
	"simule" boolean DEFAULT false NOT NULL,
	"prestations" jsonb NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prestation_mois_contrat_mois_simule_uq" UNIQUE("contrat_id","mois","simule")
);
--> statement-breakpoint
CREATE TABLE "processed_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stream" varchar(32) NOT NULL,
	"type" varchar(200) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
