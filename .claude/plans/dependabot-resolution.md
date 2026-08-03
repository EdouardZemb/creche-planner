# Plan de résolution des PR Dependabot

> **Statut au 2026-07-29** : ✅ FAIT — les 13 PR du plan sont toutes résolues. Groupe A : #89/#90/#25/#32 mergées le 2026-07-03, #106 fermée (supersédée par un groupe `dependances-mineures` ultérieur). Groupe B : #92/#93/#95/#96/#97 fermées, remplacées par la migration coordonnée Nx 23.0.1 (#148, `f5df517`) — tous les paquets Nx alignés sur 23.0.1 sur `main`. Groupe C : #35 → #149 (react-router 7.18.1, `ce079d6`), #98 → #150 (pact 17.0.1, `51374f5`), #94 → #151 (webpack-cli ^7.1.0, `0db75c0`). Hors périmètre de ce plan : 6 PR Dependabot **nouvelles** ouvertes depuis (#256 du 2026-07-29, #241→#245 du 2026-07-20).

_État au 2026-07-03. 13 PR Dependabot ouvertes._

## Constat structurant : migration Nx à moitié faite sur `main`

`main` est dans un état **incohérent** pour les paquets Nx :

| Paquet                                                                                      | Version sur `main` |
| ------------------------------------------------------------------------------------------- | ------------------ |
| `@nx/js`, `@nx/nest`, `@nx/node`                                                            | **23.0.0**         |
| `nx`, `@nx/eslint`, `@nx/eslint-plugin`, `@nx/vite`, `@nx/vitest`, `@nx/web`, `@nx/webpack` | **22.7.5**         |

Tous les paquets Nx doivent partager la même version. Ce split explique la cascade d'échecs
(`ci`, `pact-drift`, `openapi-types-drift`) sur les PR Nx individuelles.

Localisation des dépendances hors racine :

- `react-router-dom ^6.28.0`, `jsdom ^26.0.0` → `apps/web/package.json`
- `@pact-foundation/pact ^13.2.0` → les **6** services (`api-gateway`, `svc-foyer`, `svc-notifications`, `svc-planification`, `svc-referentiel`, `svc-tarification`)

---

## Classement des 13 PR

### 🟢 Groupe A — vertes, merge par simple rebase

| PR   | Sujet                                           | État CI                                                  | Action                  |
| ---- | ----------------------------------------------- | -------------------------------------------------------- | ----------------------- |
| #106 | Groupe `dependances-mineures` (14 màj mineures) | Toutes vertes, `BEHIND`                                  | Rebase → merge          |
| #89  | `actions/cache` 5.0.5→6.1.0 (CI)                | Vert                                                     | Merge                   |
| #90  | `dorny/paths-filter` 3.0.2→4.0.1 (CI)           | Vert                                                     | Merge                   |
| #25  | `actions/checkout` 6.0.3→7.0.0 (CI)             | Vert                                                     | Merge                   |
| #32  | `jsdom` 26.1.0→29.1.1 (dev, tests web)          | `UNSTABLE` (checks cœur vertes, build-images en attente) | Vérif locale puis merge |

Note #106 : bump aussi `@nx/js/nest/node` 23.0.0→23.0.1 (mineur, inoffensif) — creuse
légèrement le split Nx mais sans conséquence, le chantier B réaligne tout ensuite.

Note #32 : avant merge, lancer `pnpm nx test web` (le type-check vient avec la
cible — cf. [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md)).

**Vérif Groupe A avant merge :** confirmer que le check requis (`ci`) est bien vert sur chaque
PR après rebase.

### 🔴 Groupe B — migration Nx 22→23 (chantier unique, PAS 5 merges)

PR concernées : **#96** `nx`, **#97** `@nx/webpack`, **#95** `@nx/vite`,
**#93** `@nx/eslint-plugin`, **#92** `@nx/web` — toutes en échec.

Problème : ces PR ne modifient qu'un numéro de version dans `package.json`. Elles **n'exécutent
pas** les migrations `nx migrate`. Les merger individuellement aggraverait l'incohérence.

**Approche correcte :**

1. Fermer #92, #93, #95, #96, #97 (commenter pourquoi : superseded par migration coordonnée).
2. Branche `chore/nx-migrate-23`.
3. `pnpm nx migrate 23.0.1` (génère/ met à jour `package.json` + `migrations.json`).
4. `pnpm install` (via corepack `pnpm@10.34.2`).
5. `pnpm nx migrate --run-migrations` puis supprimer `migrations.json`.
6. Aligner **tous** les paquets Nx sur 23.0.1 (y compris js/nest/node/vitest/eslint).
7. Valider : `pnpm nx run-many -t lint typecheck test build`.
8. Une seule PR.

### 🟠 Groupe C — majors nécessitant du code (une PR manuelle chacune)

| PR  | Sujet                         | Travail attendu                                                                                                                                         |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #35 | `react-router-dom` 6→7        | Breaking (data router API, `NavLink`, types). Migration `apps/web`. Fermer #35, remplacer par PR avec code adapté                                       |
| #98 | `@pact-foundation/pact` 13→17 | Major sur 6 services, `pact-drift` rouge. Upgrade + revalidation génération des pacts consommateurs/fournisseurs                                        |
| #94 | `webpack-cli` 5→7             | Major, `ci` rouge. **Trancher d'abord l'utilité** : Nx build via `@nx/webpack`, `webpack-cli` est peut-être un vestige supprimable plutôt qu'à upgrader |

---

## Séquencement recommandé

1. **Groupe A** (5 PR vertes) — nettoie ~38 % de la file, aucun risque code réel.
2. **Groupe B** (chantier Nx 23) — débloque mécaniquement les échecs `ci`/`pact-drift` en chaîne.
3. **#35 react-router 7** — migration ciblée `apps/web`.
4. **#98 pact 17** — upgrade + revalidation pacts, 6 services.
5. **#94 webpack-cli** — décision suppression vs upgrade, en dernier (impact le plus faible).

## Garde-fous (rappels projet)

- Travailler dans le clone `-public`, jamais pousser depuis l'original.
- `main` protégée : chaque étape = branche + PR, check requis `ci` vert.
- pnpm via corepack `pnpm@10.34.2` (pas le pnpm global 8.x).
- Environnement de travail : `pnpm preflight` — cf. [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md).
