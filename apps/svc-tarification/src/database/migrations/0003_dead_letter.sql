CREATE TABLE "dead_letter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid,
	"stream" varchar(32) NOT NULL,
	"sujet" varchar(200) NOT NULL,
	"raison" varchar(32) NOT NULL,
	"payload" text NOT NULL,
	"erreur" text,
	"livraisons" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
