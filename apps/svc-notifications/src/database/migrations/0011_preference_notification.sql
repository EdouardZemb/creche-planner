CREATE TABLE "preference_notification" (
	"parent_id" uuid NOT NULL,
	"type_notification" varchar(64) NOT NULL,
	"canal" varchar(32) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preference_notification_parent_type_canal_uq" UNIQUE("parent_id","type_notification","canal")
);
