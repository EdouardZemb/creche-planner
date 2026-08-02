---
name: piege-course-build-typecheck-libs
description: "Les 14 libs gardent outDir dans dist/ — c'est mesuré et volontaire, ne pas rejouer le correctif #273 des apps"
metadata:
  node_type: memory
  type: project
  originSessionId: c21859ec-2bdc-407c-b6e5-1a897fd90f56
  modified: 2026-08-01T19:16:33.108Z
---

Question tranchée le 2026-08-01 (PR #274 ✅ mergée main `2e996b3`, documentation seule, aucun
changement de config — donc rien à déployer) : les 14
libs gardent `outDir: dist` + `tsBuildInfoFile: dist/tsconfig.lib.tsbuildinfo` dans leur
`tsconfig.lib.json`, alors que #273 vient de sortir les apps de `dist/`. **C'est délibéré.**

**Pourquoi** : sur les libs, `build` **et** `typecheck` sont inférés par `@nx/js/typescript`, qui pose
lui-même `typecheck.dependsOn = ["build", "^typecheck"]` — Nx ne les planifie jamais en parallèle. Sur
les apps, `build` vient de `@nx/webpack` : le plugin ne voit pas le recouvrement, ne pose rien, d'où la
course que #273 a corrigée. La CI n'utilise qu'une seule invocation Nx, donc l'arête s'y applique.

**How to apply** : avant de conclure à une course entre deux cibles Nx, lire
`nx show project <p> --json` → `dependsOn` (et le graphe via `--graph=<fichier>.json`). Un recouvrement
de répertoires ne prouve rien tant que l'ordonnancement n'est pas vérifié — ici l'énoncé de départ
(« aucune arête d'ordre ») était faux. Deux différences décisives avec les apps : les deux producteurs
sont `tsc` (aucun `clean`), et le `dist/` des libs est une **vraie sortie consommée**
(`require.resolve` d'une app y résout, `copy-workspace-modules` l'empaquette) — le déplacer serait
invasif.

Mesures, et surtout **conditions de réouverture**, dans l'amendement « 2026-08-01 (bis) » de
`docs/adr/0003-decisions-de-toolchain.md` ; réserve en convention 8 de `docs/06-etat-davancement.md` §5.
Voir [[plan-consolidation-ui-qualite]] (chantier B/outillage) et [[nx-webpack-cli-pin]].
