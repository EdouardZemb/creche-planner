CREATE TABLE "calendrier_periode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"etablissement_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"libelle" varchar(200) NOT NULL,
	"du" varchar(10) NOT NULL,
	"au" varchar(10) NOT NULL,
	"source" varchar(16) DEFAULT 'MANUEL' NOT NULL,
	"annee_scolaire" varchar(9),
	"importe_le" timestamp with time zone,
	"connu_depuis" timestamp with time zone NOT NULL,
	"connu_jusqua" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendrier_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"etablissement_id" uuid NOT NULL,
	"jour" varchar(10) NOT NULL,
	"type" varchar(32) NOT NULL,
	"libelle" varchar(200) NOT NULL,
	"services" jsonb,
	"connu_depuis" timestamp with time zone NOT NULL,
	"connu_jusqua" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendrier_recurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"etablissement_id" uuid NOT NULL,
	"regime" varchar(16) NOT NULL,
	"jour_semaine" varchar(16) NOT NULL,
	"services" jsonb NOT NULL,
	"connu_depuis" timestamp with time zone NOT NULL,
	"connu_jusqua" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendrier_regime_feries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"etablissement_id" uuid NOT NULL,
	"regime" varchar(32) NOT NULL,
	"connu_depuis" timestamp with time zone NOT NULL,
	"connu_jusqua" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "zone_scolaire" varchar(1);--> statement-breakpoint
ALTER TABLE "calendrier_periode" ADD CONSTRAINT "calendrier_periode_etablissement_id_etablissement_id_fk" FOREIGN KEY ("etablissement_id") REFERENCES "public"."etablissement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendrier_exception" ADD CONSTRAINT "calendrier_exception_etablissement_id_etablissement_id_fk" FOREIGN KEY ("etablissement_id") REFERENCES "public"."etablissement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendrier_recurrence" ADD CONSTRAINT "calendrier_recurrence_etablissement_id_etablissement_id_fk" FOREIGN KEY ("etablissement_id") REFERENCES "public"."etablissement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendrier_regime_feries" ADD CONSTRAINT "calendrier_regime_feries_etablissement_id_etablissement_id_fk" FOREIGN KEY ("etablissement_id") REFERENCES "public"."etablissement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendrier_periode_etab_du_idx" ON "calendrier_periode" USING btree ("etablissement_id","du");--> statement-breakpoint
CREATE UNIQUE INDEX "calendrier_exception_jour_ouvert_uq" ON "calendrier_exception" USING btree ("etablissement_id","jour") WHERE "calendrier_exception"."connu_jusqua" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "calendrier_recurrence_ouvert_uq" ON "calendrier_recurrence" USING btree ("etablissement_id","regime","jour_semaine") WHERE "calendrier_recurrence"."connu_jusqua" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "calendrier_regime_feries_ouvert_uq" ON "calendrier_regime_feries" USING btree ("etablissement_id") WHERE "calendrier_regime_feries"."connu_jusqua" is null;--> statement-breakpoint
-- Reprise : chaque établissement existant se voit poser sa ligne de régime OUVERTE,
-- au régime national `FR` — le défaut implicite d'avant ce lot (D7). `connu_depuis`
-- vaut la création de l'établissement, pas l'instant de migration : c'est la vérité,
-- « on a toujours su FR », et cela évite un trou de connaissance sur les mois déjà
-- facturés (un `aLaDate` antérieur à la migration trouverait sinon zéro ligne).
INSERT INTO "calendrier_regime_feries" ("etablissement_id", "regime", "connu_depuis")
SELECT "id", 'FR', "created_at" FROM "etablissement";
