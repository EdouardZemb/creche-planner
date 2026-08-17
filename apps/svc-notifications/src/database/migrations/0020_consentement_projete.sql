-- Consentement PROJETÉ, plus déduit (lot 2 « le coût ne ment plus », AM-57), côté
-- read model. `DestinatairesService` gardait tout parent dont la préférence n'était pas
-- explicitement `actif = false` — jointure gauche NULL comprise. Supprimer la ligne d'un
-- parent désabonné le remettait donc dans la liste d'envoi. Le filtre est désormais
-- fermé (`actif = true` exigé), ce qui suppose que les parents consentants aient bien
-- leur ligne : c'est l'objet de ce back-fill.
--
-- La population de référence est `foyer_parent`, le read model des parents projeté
-- depuis le stream FOYER — le seul inventaire dont ce service dispose. Les parents
-- créés APRÈS cette migration n'en dépendent pas : `svc-foyer` matérialise leur
-- consentement à l'inscription et l'émet en `PreferencesNotifModifiees`, que la
-- projection applique. Ce service n'a donc aucune matrice par défaut à recopier ; la
-- liste `(VALIDATION_HEBDO, EMAIL|IN_APP)` ci-dessous est une **recopie datée** de
-- l'état amont au 2026-08-17, pas un miroir vivant.
--
-- `ON CONFLICT DO NOTHING` : toute préférence déjà projetée — désabonnement compris —
-- est intouchée. Aucun DDL ; rollback = `DELETE FROM preference_notification WHERE
-- event_id IS NULL AND occurred_at IS NULL` (aucune ligne projetée n'a ces deux
-- colonnes nulles : la projection renseigne toujours l'événement d'origine).
INSERT INTO "preference_notification"
  ("parent_id", "type_notification", "canal", "actif", "event_id", "occurred_at", "updated_at")
SELECT
  fp."parent_id",
  'VALIDATION_HEBDO',
  c."canal",
  true,
  NULL,
  NULL,
  now()
FROM "foyer_parent" AS fp
CROSS JOIN (VALUES ('EMAIL'), ('IN_APP')) AS c("canal")
ON CONFLICT ("parent_id", "type_notification", "canal") DO NOTHING;
