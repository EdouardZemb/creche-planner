-- Unicité e-mail parent : de GLOBALE (`lower(email)`) à PAR FOYER, parents ACTIFS
-- seulement — index partiel `(foyer_id, lower(email)) WHERE actif`. Débloque la
-- réactivation d'un parent retiré (soft-delete) et les familles recomposées (un
-- même e-mail parent de plusieurs foyers).
--
-- Réversibilité CONDITIONNELLE : on peut recréer l'index global
-- `parent_email_unique_idx` (`CREATE UNIQUE INDEX ... ON parent (lower(email))`)
-- **tant qu'aucun doublon inter-foyers n'existe** en base (sinon la recréation
-- échoue sur la violation d'unicité). Données prod actuelles (2 parents, e-mails
-- distincts) : aucun doublon, substitution sans risque.
DROP INDEX "parent_email_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "parent_email_par_foyer_actif_idx" ON "parent" USING btree ("foyer_id",lower("email")) WHERE "parent"."actif";