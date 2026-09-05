-- SFD 31 lot 4 — l'ancre de connaissance du montant (RM-31-03).
--
-- ADDITIVE et nullable : aucune ligne existante n'est touchée, et `null` veut dire
-- « mois non facturé », donc « suit le calendrier courant » — soit exactement le
-- comportement d'avant ce lot. Le back-fill n'aurait aucun sens : on ne peut pas
-- inventer après coup la date à laquelle un mois a été arrêté.
ALTER TABLE "planning_mois" ADD COLUMN IF NOT EXISTS "facture_le" timestamp with time zone;
