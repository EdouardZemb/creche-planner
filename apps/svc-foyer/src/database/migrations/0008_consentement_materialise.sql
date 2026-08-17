-- Matérialisation du consentement aux notifications (lot 2 « le coût ne ment plus »,
-- AM-57). Le consentement se déduisait d'une ABSENCE de ligne : la matrice §5.1 était
-- un repli de lecture, si bien que supprimer une ligne `actif = false` — purge de
-- rétention, effacement, geste manuel — RÉABONNAIT le parent, sans trace. C'est
-- précisément la population que la borne T3bis (doc 37) visait.
--
-- Ce back-fill écrit ce qui était déduit : une ligne par combinaison de la matrice pour
-- chaque parent existant, `actif = true` (le défaut applicatif dont ils bénéficiaient),
-- `consentement_at = parent.created_at` (l'instant où ils sont entrés dans le foyer,
-- seul instant honnête ici) et `source_dernier = 'DEFAUT'` — la valeur par défaut de la
-- colonne, qui distingue pour toujours un consentement HÉRITÉ du défaut d'un geste de
-- l'utilisateur (`ECRAN`, `LIEN_DESABO`).
--
-- `ON CONFLICT DO NOTHING` : les parents ayant déjà exprimé un choix — désabonnés
-- compris — ne sont pas touchés. Sans cette clause, la migration censée protéger les
-- désabonnés les aurait tous réabonnés d'un coup.
--
-- Aucun DDL : la table, ses colonnes (`consentement_at`, `desabonne_at`,
-- `source_dernier`) et son index unique existent depuis `0002`. Rollback =
-- `DELETE FROM preference_notification WHERE source_dernier = 'DEFAUT'`, qui rend
-- l'état antérieur exactement (aucune de ces lignes n'existait).
INSERT INTO "preference_notification"
  ("id", "parent_id", "type_notification", "canal", "actif", "consentement_at", "desabonne_at", "source_dernier", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  p."id",
  'VALIDATION_HEBDO',
  c."canal",
  true,
  p."created_at",
  NULL,
  'DEFAUT',
  now(),
  now()
FROM "parent" AS p
CROSS JOIN (VALUES ('EMAIL'), ('IN_APP')) AS c("canal")
ON CONFLICT ("parent_id", "type_notification", "canal") DO NOTHING;
