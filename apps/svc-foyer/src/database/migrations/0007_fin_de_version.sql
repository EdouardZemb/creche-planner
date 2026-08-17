ALTER TABLE "foyer_version" ADD COLUMN "date_fin" date;--> statement-breakpoint
-- Matérialisation de la fin de version (lot 1 « le coût ne ment plus », AM-55) :
-- la fin d'une version était dérivée à la lecture (veille de la date d'effet
-- suivante, dernière version ouverte). Ce back-fill l'écrit une fois pour toutes ;
-- `materialiserFins` la maintient ensuite dans la transaction qui touche
-- l'historique. `date_fin IS NULL` = version EN VIGUEUR (aucune suivante), et c'est
-- cette distinction — impossible avant — qu'une borne de rétention doit respecter.
UPDATE "foyer_version" AS v
SET "date_fin" = (
  SELECT MIN(s."date_effet") - 1
  FROM "foyer_version" AS s
  WHERE s."foyer_id" = v."foyer_id" AND s."date_effet" > v."date_effet"
);--> statement-breakpoint
-- Index de la borne de rétention T1 (doc 37 §3) : `CREATE INDEX` simple, jamais
-- `CONCURRENTLY` — le migrator drizzle enveloppe toutes les migrations en attente
-- dans une seule transaction et Postgres refuse `CONCURRENTLY` dans un bloc
-- transactionnel (AM-62). Partiel : une version en vigueur n'est jamais purgée,
-- elle n'a donc rien à faire dans l'index.
CREATE INDEX "foyer_version_date_fin_idx" ON "foyer_version" USING btree ("date_fin") WHERE "foyer_version"."date_fin" is not null;
