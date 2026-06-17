CREATE TABLE "contrat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"enfant" varchar(200) NOT NULL,
	"mode" varchar(32) NOT NULL,
	"valide_du" varchar(10) NOT NULL,
	"valide_au" varchar(10),
	"heures_annuelles_contractualisees" integer,
	"nb_mensualites" integer,
	"semaine_type" jsonb,
	"semaine_abcm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "planning_mois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrat_id" uuid NOT NULL,
	"mois" varchar(7) NOT NULL,
	"simule" boolean DEFAULT false NOT NULL,
	"saisie" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_mois_contrat_mois_simule_uq" UNIQUE("contrat_id","mois","simule")
);
--> statement-breakpoint
ALTER TABLE "planning_mois" ADD CONSTRAINT "planning_mois_contrat_id_contrat_id_fk" FOREIGN KEY ("contrat_id") REFERENCES "public"."contrat"("id") ON DELETE cascade ON UPDATE no action;