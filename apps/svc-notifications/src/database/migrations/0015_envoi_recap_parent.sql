CREATE TABLE "envoi_recap_parent" (
	"foyer_id" uuid NOT NULL,
	"semaine_iso" varchar(8) NOT NULL,
	"parent_id" uuid NOT NULL,
	"statut" varchar(16) NOT NULL,
	"email" varchar(320) NOT NULL,
	"essais" integer DEFAULT 0 NOT NULL,
	"message_id" varchar(998),
	"erreur" text,
	"envoye_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envoi_recap_parent_foyer_id_semaine_iso_parent_id_pk" PRIMARY KEY("foyer_id","semaine_iso","parent_id")
);
