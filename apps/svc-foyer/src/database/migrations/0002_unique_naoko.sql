CREATE TABLE "desabonnement_token" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid NOT NULL,
	"type_notification" varchar(64) NOT NULL,
	"canal" varchar(32) NOT NULL,
	"emis_le" timestamp with time zone DEFAULT now() NOT NULL,
	"utilise_le" timestamp with time zone,
	"expire_le" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preference_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"type_notification" varchar(64) NOT NULL,
	"canal" varchar(32) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"consentement_at" timestamp with time zone,
	"desabonne_at" timestamp with time zone,
	"source_dernier" varchar(32) DEFAULT 'DEFAUT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desabonnement_token" ADD CONSTRAINT "desabonnement_token_parent_id_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_notification" ADD CONSTRAINT "preference_notification_parent_id_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preference_notification_unique_idx" ON "preference_notification" USING btree ("parent_id","type_notification","canal");