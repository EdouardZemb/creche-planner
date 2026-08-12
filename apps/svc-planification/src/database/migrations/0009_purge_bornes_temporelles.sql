CREATE INDEX "dead_letter_created_at_idx" ON "dead_letter" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "outbox_backlog_idx" ON "outbox" USING btree ("occurred_at") WHERE "outbox"."published_at" is null;