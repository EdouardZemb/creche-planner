CREATE TABLE "bareme_psu" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"valide_du" date NOT NULL,
	"valide_au" date,
	"taux" jsonb NOT NULL,
	"plancher_centimes" bigint,
	"plafond_centimes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frais_fixes_abcm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"valide_du" date NOT NULL,
	"valide_au" date,
	"cotisation_1_enfant_centimes" bigint NOT NULL,
	"premiere_inscription_centimes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grille_abcm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tranche" integer NOT NULL,
	"valide_du" date NOT NULL,
	"valide_au" date,
	"cantine_total_centimes" bigint NOT NULL,
	"cantine_part_garde_centimes" bigint,
	"peri_matin_centimes" bigint NOT NULL,
	"peri_soir_centimes" bigint NOT NULL,
	"alsh_journee_complete_centimes" bigint NOT NULL,
	"alsh_demi_journee_centimes" bigint NOT NULL,
	"alsh_repas_centimes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jour_non_facturable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jour" date NOT NULL,
	"type" varchar(40) NOT NULL,
	"libelle" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
