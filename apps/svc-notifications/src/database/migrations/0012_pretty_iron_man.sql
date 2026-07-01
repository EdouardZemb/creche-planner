CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"sujet" varchar(300) NOT NULL,
	"corps" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"lu_le" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "notification_parent_id_idx" ON "notification" USING btree ("parent_id");