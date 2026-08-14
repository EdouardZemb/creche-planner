## Résumé

<!-- Quoi et pourquoi, en quelques lignes. Lier la doc/phase concernée si pertinent. -->

## Checklist

- [ ] `pnpm nx affected -t lint typecheck test build` vert en local.
- [ ] Contrats **Pact** à jour si une interaction gateway ↔ service a changé.
- [ ] Tout **parcours utilisateur modifié** est couvert/maj par un test E2E stack réelle (`*.stack.e2e.spec.ts`).
- [ ] Documentation à jour si une règle métier ou une convention a changé (`docs/`).
- [ ] **README** à jour : `pnpm readme` vert (il dérive de la CI, des ADR, des lots livrés et de `docs/`), **et** relecture à la main de ce qu'il promet — capacité produit, commande de tous les jours, prérequis — que la porte ne sait pas juger.
- [ ] Pas de TODO non tracké ; questions `Q-xx` résolues ou explicitement reportées.
- [ ] **Registre** ([doc 34](../docs/34-registre-ameliorations.md)) : pistes et leçons vues pendant ce lot consignées (`AM-xx`, `LE-xx`) — ou « néant », et pourquoi.
- [ ] **Empêchements** ([doc 34 §6](../docs/34-registre-ameliorations.md#6-empêchements-doutillage--em-xx)) : toute limitation de l'atelier qui a fait livrer **moins bien** que le lot ne le demandait est consignée (`EM-xx`) — c'est **maintenant** ou jamais, une session ne survit pas au merge de sa PR. Filtre en §1.5 ; « néant » est une réponse.
- [ ] Pour un correctif (`fix:`) : ligne **« Cause racine : … — Prévention : … »** dans le commit + test de non-régression (cf. [doc 03](../docs/03-standards-developpement.md) §8).

## Revue assistée par IA

<!-- Substitut au relecteur humain indépendant (bus factor = 1, cf. doc 18 axe F.4 / P2-9).
     Tracer le verdict de la revue de code assistée par IA : portée, constats, décisions. -->

- **Outil / portée** : <!-- ex. revue du diff complet -->
- **Verdict** : <!-- ✅ aucun blocant / ⚠️ constats traités ci-dessous / 🔴 à corriger -->
- **Constats & suites données** : <!-- bugs/réserves relevés et ce qui en a été fait -->
