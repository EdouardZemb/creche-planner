CREATE TABLE "bareme_tranches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"valide_du" date NOT NULL,
	"valide_au" date,
	"seuils" jsonb NOT NULL,
	"version_payload" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
