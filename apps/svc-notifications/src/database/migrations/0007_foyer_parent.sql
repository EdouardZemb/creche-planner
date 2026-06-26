CREATE TABLE "foyer_parent" (
	"parent_id" uuid PRIMARY KEY NOT NULL,
	"foyer_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
