ALTER TABLE "foyer_version" ADD COLUMN "date_fin" varchar(10);--> statement-breakpoint
-- Copie de la fin de version amont (lot 1 « le coût ne ment plus », AM-55). Le
-- back-fill dérive ici la même borne que `svc-foyer` : la projection ne peut pas
-- attendre qu'un foyer soit ré-enregistré pour cesser de valoriser un mois passé
-- avec des ressources qui ne le couvrent pas. `date_fin IS NULL` = EN VIGUEUR.
-- `varchar(10)` : comparaison lexicographique ISO, comme `date_effet`.
UPDATE "foyer_version" AS v
SET "date_fin" = to_char(
  (SELECT MIN(s."date_effet") FROM "foyer_version" AS s
   WHERE s."foyer_id" = v."foyer_id" AND s."date_effet" > v."date_effet")::date - 1,
  'YYYY-MM-DD'
);--> statement-breakpoint
-- Index de la borne de rétention T1 (doc 37 §3). `CREATE INDEX` simple : le
-- migrator drizzle enveloppe les migrations en attente dans une seule transaction,
-- où `CONCURRENTLY` est refusé (AM-62). Partiel — une version en vigueur n'est
-- jamais purgée.
CREATE INDEX "foyer_version_date_fin_idx" ON "foyer_version" USING btree ("date_fin") WHERE "foyer_version"."date_fin" is not null;
