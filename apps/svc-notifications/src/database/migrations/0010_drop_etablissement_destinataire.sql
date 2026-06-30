-- P6 : démantèlement de l'ancien annuaire à clé fermée. La source de vérité des
-- établissements est `svc-planification` (entité libre par foyer), projetée dans la
-- table `etablissement` ; le routage des récaps passe par `contrat.etablissement_id`.
-- Cette table n'est plus ni semée ni lue (back-fill prod P5 exécuté au préalable).
DROP TABLE "etablissement_destinataire" CASCADE;
