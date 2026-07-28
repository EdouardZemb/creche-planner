CREATE TABLE "bareme_tranches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"valide_du" varchar(10) NOT NULL,
	"valide_au" varchar(10),
	"seuils" jsonb NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bareme_tranches_du_uq" UNIQUE("valide_du")
);
--> statement-breakpoint
CREATE TABLE "correction_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"avant" jsonb NOT NULL,
	"apres" jsonb NOT NULL,
	"motif" varchar(500),
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid,
	"stream" varchar(32) NOT NULL,
	"sujet" varchar(200) NOT NULL,
	"raison" varchar(32) NOT NULL,
	"payload" text NOT NULL,
	"erreur" text,
	"livraisons" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foyer_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"date_effet" date NOT NULL,
	"ressources_mensuelles_centimes" bigint NOT NULL,
	"rfr_centimes" bigint NOT NULL,
	"nb_enfants_a_charge" integer NOT NULL,
	"nb_parts" double precision NOT NULL,
	"saisi_le" timestamp with time zone DEFAULT now() NOT NULL,
	"motif" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foyer_version_foyer_date_uq" UNIQUE("foyer_id","date_effet")
);
--> statement-breakpoint
CREATE TABLE "processed_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stream" varchar(32) NOT NULL,
	"type" varchar(200) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "correction_journal" ADD CONSTRAINT "correction_journal_foyer_id_foyer_id_fk" FOREIGN KEY ("foyer_id") REFERENCES "public"."foyer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foyer_version" ADD CONSTRAINT "foyer_version_foyer_id_foyer_id_fk" FOREIGN KEY ("foyer_id") REFERENCES "public"."foyer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Back-fill (SFD 30, lot 3) : une version de ressources par foyer existant, à la
-- date de création (date d'effet = created_at). `to_char(...)::date` fige la date
-- calendaire (comparaison lexicographique ISO côté résolution), pas un timestamp.
INSERT INTO "foyer_version" ("id","foyer_id","date_effet","ressources_mensuelles_centimes","rfr_centimes","nb_enfants_a_charge","nb_parts","saisi_le","created_at")
SELECT gen_random_uuid(), "id", (to_char("created_at", 'YYYY-MM-DD'))::date, "ressources_mensuelles_centimes", "rfr_centimes", "nb_enfants_a_charge", "nb_parts", "created_at", "created_at"
FROM "foyer"
ON CONFLICT ("foyer_id","date_effet") DO NOTHING;