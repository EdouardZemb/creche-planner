CREATE TABLE "contrat_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrat_id" uuid NOT NULL,
	"date_effet" varchar(10) NOT NULL,
	"heures_annuelles_contractualisees" double precision,
	"nb_mensualites" integer,
	"semaine_type" jsonb,
	"semaine_abcm" jsonb,
	"saisi_le" timestamp with time zone DEFAULT now() NOT NULL,
	"motif" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contrat_version_contrat_date_uq" UNIQUE("contrat_id","date_effet")
);
--> statement-breakpoint
CREATE TABLE "correction_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrat_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"avant" jsonb NOT NULL,
	"apres" jsonb NOT NULL,
	"motif" varchar(500),
	"corrige_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contrat_version" ADD CONSTRAINT "contrat_version_contrat_id_contrat_id_fk" FOREIGN KEY ("contrat_id") REFERENCES "public"."contrat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_journal" ADD CONSTRAINT "correction_journal_contrat_id_contrat_id_fk" FOREIGN KEY ("contrat_id") REFERENCES "public"."contrat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Back-fill (SFD 30 lot 4) : une version initiale par contrat existant, à
-- `date_effet = valide_du`, reprenant ses paramètres versionnés courants. Les
-- colonnes de `contrat` restent la projection de cette version (aucun lecteur à
-- migrer). Idempotent via l'unicité (contrat_id, date_effet).
INSERT INTO "contrat_version" (
	"contrat_id", "date_effet", "heures_annuelles_contractualisees",
	"nb_mensualites", "semaine_type", "semaine_abcm", "saisi_le"
)
SELECT
	"id", "valide_du", "heures_annuelles_contractualisees",
	"nb_mensualites", "semaine_type", "semaine_abcm", "created_at"
FROM "contrat"
ON CONFLICT ("contrat_id", "date_effet") DO NOTHING;