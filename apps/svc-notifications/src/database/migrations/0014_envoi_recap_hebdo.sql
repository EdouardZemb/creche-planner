CREATE TABLE "envoi_recap_hebdo" (
	"foyer_id" uuid NOT NULL,
	"semaine_iso" varchar(8) NOT NULL,
	"statut" varchar(16) NOT NULL,
	"destinataires" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_id" varchar(998),
	"erreur" text,
	"envoye_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envoi_recap_hebdo_foyer_id_semaine_iso_pk" PRIMARY KEY("foyer_id","semaine_iso")
);
