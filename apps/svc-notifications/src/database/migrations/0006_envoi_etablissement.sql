CREATE TABLE "envoi_etablissement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"semaine_iso" varchar(8) NOT NULL,
	"etablissement_cle" varchar(32) NOT NULL,
	"destinataire" varchar(320) NOT NULL,
	"sujet" varchar(300) NOT NULL,
	"corps" text NOT NULL,
	"statut" varchar(16) NOT NULL,
	"message_id" varchar(998),
	"erreur" text,
	"envoye_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envoi_etablissement_foyer_semaine_etab_uq" UNIQUE("foyer_id","semaine_iso","etablissement_cle")
);
