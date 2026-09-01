-- SFD 40 — Unités associatives : suivi de l'engagement de bénévolat du foyer.
--
-- Migration strictement ADDITIVE : trois tables nouvelles, aucune colonne touchée,
-- aucune donnée réécrite. Un déploiement qui s'arrêterait ici laisse le service
-- exactement dans son état d'avant.
--
-- `quota_heures` / `duree_heures` en `numeric` (et non `integer`) : une demi-heure
-- de ménage existe, et la variante « double accès portail » du règlement intérieur
-- vaut 10 UA par parent (Q-40-02). Les montants restent en centimes entiers,
-- cohérents avec `Money`.
CREATE TABLE "engagement_ua" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"debut" varchar(10) NOT NULL,
	"fin" varchar(10) NOT NULL,
	"quota_heures" numeric NOT NULL,
	"valeur_ua_centimes" integer NOT NULL,
	"caution_centimes" integer,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_ua_foyer_debut_uq" UNIQUE("foyer_id","debut")
);
--> statement-breakpoint
-- Pas de clé étrangère vers `foyer` : cette table-là est un READ MODEL, qui peut
-- être froid quand le parent déclare son engagement. La cascade d'effacement est
-- donc explicite, dans le consommateur de `foyer.FoyerSupprime.v1`.
CREATE TABLE "session_ua" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"foyer_id" uuid NOT NULL,
	"date" varchar(10) NOT NULL,
	"duree_heures" numeric NOT NULL,
	"type" varchar(32) NOT NULL,
	"realise_par" varchar(200),
	"etablissement_id" uuid,
	"etat" varchar(16) NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Piste d'audit acteur du service (doc 37 §7), née avec ses premières routes de
-- mutation (RM-40-08). Sans clé étrangère, pour la même raison que ci-dessus.
CREATE TABLE "journal_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"cible_type" varchar(32) NOT NULL,
	"cible_id" uuid,
	"acteur_type" varchar(16) NOT NULL,
	"acteur" varchar(320),
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_ua" ADD CONSTRAINT "session_ua_engagement_id_engagement_ua_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement_ua"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `CREATE INDEX` simple, jamais `CONCURRENTLY` : le migrator drizzle enveloppe les
-- migrations en attente dans une seule transaction, qui le refuse (AM-62).
CREATE INDEX "engagement_ua_foyer_idx" ON "engagement_ua" USING btree ("foyer_id");--> statement-breakpoint
CREATE INDEX "session_ua_engagement_date_idx" ON "session_ua" USING btree ("engagement_id","date");--> statement-breakpoint
CREATE INDEX "session_ua_foyer_idx" ON "session_ua" USING btree ("foyer_id");--> statement-breakpoint
CREATE INDEX "journal_audit_foyer_date_idx" ON "journal_audit" USING btree ("foyer_id","cree_le");
