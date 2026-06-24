CREATE TABLE "etablissement_destinataire" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cle" varchar(32) NOT NULL,
	"libelle" varchar(200) NOT NULL,
	"email_service" varchar(320) NOT NULL,
	"preavis_regle" jsonb NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etablissement_destinataire_cle_unique" UNIQUE("cle")
);
