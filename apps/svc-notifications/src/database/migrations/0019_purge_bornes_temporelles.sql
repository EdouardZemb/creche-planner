CREATE INDEX "dead_letter_created_at_idx" ON "dead_letter" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "envoi_etablissement_created_at_idx" ON "envoi_etablissement" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "envoi_recap_hebdo_cree_le_idx" ON "envoi_recap_hebdo" USING btree ("cree_le");--> statement-breakpoint
CREATE INDEX "envoi_recap_parent_cree_le_idx" ON "envoi_recap_parent" USING btree ("cree_le");--> statement-breakpoint
CREATE INDEX "notification_cree_le_idx" ON "notification" USING btree ("cree_le");--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "outbox_backlog_idx" ON "outbox" USING btree ("occurred_at") WHERE "outbox"."published_at" is null;