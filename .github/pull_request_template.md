## Résumé

<!-- Quoi et pourquoi, en quelques lignes. Lier la doc/phase concernée si pertinent. -->

## Checklist

- [ ] `pnpm nx affected -t lint typecheck test build` vert en local.
- [ ] Contrats **Pact** à jour si une interaction gateway ↔ service a changé.
- [ ] Tout **parcours utilisateur modifié** est couvert/maj par un test E2E stack réelle (`*.stack.e2e.spec.ts`).
- [ ] Documentation à jour si une règle métier ou une convention a changé (`docs/`).
- [ ] Pas de TODO non tracké ; questions `Q-xx` résolues ou explicitement reportées.
- [ ] Pour un correctif (`fix:`) : ligne **« Cause racine : … — Prévention : … »** dans le commit + test de non-régression (cf. [doc 03](../docs/03-standards-developpement.md) §8).

## Revue assistée par IA

<!-- Substitut au relecteur humain indépendant (bus factor = 1, cf. doc 18 axe F.4 / P2-9).
     Tracer le verdict de la revue de code assistée par IA : portée, constats, décisions. -->

- **Outil / portée** : <!-- ex. revue du diff complet -->
- **Verdict** : <!-- ✅ aucun blocant / ⚠️ constats traités ci-dessous / 🔴 à corriger -->
- **Constats & suites données** : <!-- bugs/réserves relevés et ce qui en a été fait -->
