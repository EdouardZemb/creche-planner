CREATE TABLE "contrat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"enfant" varchar(200) NOT NULL,
	"mode" varchar(32) NOT NULL,
	"valide_du" varchar(10) NOT NULL,
	"valide_au" varchar(10),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
