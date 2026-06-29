-- Le récap agrégé n'est plus adressé par la `cle` d'annuaire fermé
-- (CRECHE_HIRONDELLES | ABCM) mais par l'`id` réel de l'établissement (entité libre
-- par foyer, P3), routé via le lien explicite contrat→établissement. La clé d'adressage
-- change de nature (enum texte → uuid) : aucune correspondance ne permet de back-filler
-- les anciennes lignes. On recrée donc la table (même parti pris que 0005→0006 lors du
-- passage par-contrat → par-établissement) ; ce journal d'idempotence est régénérable et
-- l'envoi reste neutralisé (dry-run) en production.
DROP TABLE "envoi_etablissement";
--> statement-breakpoint
CREATE TABLE "envoi_etablissement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"semaine_iso" varchar(8) NOT NULL,
	"etablissement_id" uuid NOT NULL,
	"destinataire" varchar(320) NOT NULL,
	"sujet" varchar(300) NOT NULL,
	"corps" text NOT NULL,
	"statut" varchar(16) NOT NULL,
	"message_id" varchar(998),
	"erreur" text,
	"envoye_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envoi_etablissement_foyer_semaine_etab_uq" UNIQUE("foyer_id","semaine_iso","etablissement_id")
);
