CREATE INDEX "dead_letter_created_at_idx" ON "dead_letter" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "desabonnement_token_emis_le_idx" ON "desabonnement_token" USING btree ("emis_le");--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "outbox_backlog_idx" ON "outbox" USING btree ("occurred_at") WHERE "outbox"."published_at" is null;