CREATE TABLE "enfant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"prenom" varchar(200) NOT NULL,
	"date_naissance" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foyer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ressources_mensuelles_centimes" bigint NOT NULL,
	"rfr_centimes" bigint NOT NULL,
	"nb_enfants_a_charge" integer NOT NULL,
	"nb_parts" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "enfant" ADD CONSTRAINT "enfant_foyer_id_foyer_id_fk" FOREIGN KEY ("foyer_id") REFERENCES "public"."foyer"("id") ON DELETE cascade ON UPDATE no action;