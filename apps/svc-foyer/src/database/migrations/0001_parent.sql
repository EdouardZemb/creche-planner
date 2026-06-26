CREATE TABLE "parent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"prenom" varchar(200),
	"nom" varchar(200),
	"email" varchar(320) NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"ordre" integer DEFAULT 0 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parent" ADD CONSTRAINT "parent_foyer_id_foyer_id_fk" FOREIGN KEY ("foyer_id") REFERENCES "public"."foyer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parent_email_unique_idx" ON "parent" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "parent_principal_unique_idx" ON "parent" USING btree ("foyer_id") WHERE "parent"."principal";