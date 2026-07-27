CREATE TABLE "bareme_psu" (
	"id" uuid PRIMARY KEY NOT NULL,
	"valide_du" varchar(10) NOT NULL,
	"valide_au" varchar(10),
	"taux" jsonb NOT NULL,
	"plancher_centimes" integer,
	"plafond_centimes" integer,
	"event_id" uuid,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bareme_psu_du_uq" UNIQUE("valide_du")
);
