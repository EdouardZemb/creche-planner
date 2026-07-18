ALTER TABLE "contrat" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "contrat" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "foyer_parent" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "foyer_parent" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "preference_notification" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "preference_notification" ADD COLUMN "occurred_at" timestamp with time zone;