---
name: feature-qualite-couts
description: 'Chantier qualité « Coûts » — ✅ COMPLET 6/6 + ✅ DÉPLOYÉ PROD 0.11.0 (2026-07-14), reste action PO post-deploy (cocher Première inscription sur contrats ABCM 2026)'
metadata:
  node_type: memory
  type: project
  originSessionId: 87230e0f-2d28-48fd-b084-6b0dfc14b4aa
---

Chantier qualité front+back de la fonctionnalité **Coûts** (CoutsAnnuelsPage, PanneauCoutMois, svc-tarification). Audit du 2026-07-10 validé PO ; plan auto-portant `.claude/plans/qualite-couts.md` (6 PR). **✅ CHANTIER COMPLET 6/6, tout mergé main (exécution orchestrée multi-agents 2026-07-10→11)** :

- **Lot 1** ✅ #187 `38622da` — tableau annuel mobile-first (plus de min-width 640px, cartes simulation < 768 px), année ◀▶ via `?annee=` (helper `setParam` local).
- **Lot 2** ✅ #191 `5c7e4b9` — toggle « Mode simulation » sur la page Coûts, Delta→« Écart »/« Simulé »/« Réel », helper `titrePrestationCout` (« Frais annuels — ABCM »), état vide EtatVide + CTA contrats. Arbitrage assumé : badge PlanningPage aussi renommé `SIMULATION`→`Simulation` (contradiction interne du plan tranchée côté critère d'acceptation).
- **Lot 3** ✅ #188 `f079558` — repli échoué → `ServiceUnavailableException` 503 (plus de « foyer neutre » T3/0 € ni contrat omis) ; `cout.service.spec.ts` créé (9 tests).
- **Lot 4a** ✅ #190 `7d9bd98` — contrat porte `premiereInscription` (événements additifs nullish, migration planif 0006, 5 points d'émission outbox, pact régénéré à blanc, case ContratForm ABCM only). Piège trouvé hors plan : reconduire le champ dans `socleContratDurable` (PUT durable = remplacement complet).
- **Lot 4b** ✅ #192 `53a4249` — module domaine pur `premiere-annee-abcm` (année scolaire de `valideDu`), migration tarification 0002, projection + `set` des onConflictDoUpdate, hardcode « 2026/Zoé » supprimé ; seed marque `premiereInscription: true` + **nouvelle cible oracle `2026-09` minCentimes 43601** (le 436 € de doc 14 n'était gardé nulle part avant).
- **Lot 5** ✅ #193 `c5009b0` — PanneauCoutMois sur `useAsync` ×2 + bouton « Réessayer », `useCouts.ts` SUPPRIMÉ (hooks morts), styles inline→classes, `#e5e7eb`→`var(--bordure)`. NB : 1er agent (Sonnet) tué par limite de session avec le diff prêt non commité → repris tel quel par un agent Opus (implémentation conforme, 0 correction).
- Hotfix au passage : #189 `3b253b6` bump `OS_PATCH` Dockerfile web 2026-07-10 (CVE-2026-33630 c-ares) — procédure documentée dans le Dockerfile, à réutiliser à la prochaine CVE base-image.

**✅ DÉPLOYÉ PROD `0.11.0` le 2026-07-14** (12e release train, Deployment #5442718810 ; migrations planif `0006` + tarification `0002` vérifiées appliquées = `contrat.premiere_inscription boolean NOT NULL default false`). **Reste action PO post-deploy** : cocher « Première inscription » sur les contrats ABCM 2026 via l'écran Contrats (pas de back-fill ; d'ici là sept. 2026 prod = 286 € au lieu de 436 €, assumé). Détail deploy + CVE-drift web du train dans [[prod-deployment-facts]].

**Pièges d'orchestration retenus** : merges en série (protection « branche à jour » → update-branch + cycle CI complet entre chaque merge ; `gh pr merge --auto --delete-branch` ne supprime PAS la branche distante au merge différé) ; `gh pr checks --watch` lancé juste après update-branch rend la main avant l'enregistrement des checks (attendre ~30 s).

**Dette documentée (décision PO, ne pas re-signaler)** : `grille_tarifaire` projetée jamais lue (GrillePubliee sans effet sur les prix) ; contrat ABCM démarrant après septembre → pas de frais fixes cette année scolaire.

Voir aussi [[prod-deployment-facts]], [[feature-contrat-enfant-id]] (précédent champ additif de contrat), [[verif-ui-locale-stack]].
