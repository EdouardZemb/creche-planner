CREATE TABLE "journal_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foyer_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"cible_type" varchar(32) NOT NULL,
	"cible_id" uuid,
	"acteur_type" varchar(16) NOT NULL,
	"acteur" varchar(320),
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_audit" ADD CONSTRAINT "journal_audit_foyer_id_foyer_id_fk" FOREIGN KEY ("foyer_id") REFERENCES "public"."foyer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_audit_foyer_date_idx" ON "journal_audit" USING btree ("foyer_id","cree_le");