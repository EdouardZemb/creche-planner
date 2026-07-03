# Conventions de code — TypeScript / React (état de l'art)

Ce document fige les conventions « exigeantes » adoptées dans le monorepo. Elles
sont **outillées** (tsconfig + ESLint type-aware), donc vérifiées par le check
`ci`, pas seulement recommandées.

## 1. TypeScript

Configuration stricte au-delà de `strict` (cf. [`tsconfig.base.json`](tsconfig.base.json)) :

- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — distinguent
  l'absence d'une valeur de `undefined` ; tout accès indexé est `T | undefined`.
- `noPropertyAccessFromIndexSignature` — accès par crochet `obj['cle']` quand la
  clé vient d'une index signature (ex. `process.env['CI']`).
- `noUncheckedSideEffectImports`, `allowUnreachableCode: false`,
  `allowUnusedLabels: false`.
- `verbatimModuleSyntax` — **frontend uniquement** (`apps/web`). Exclu des
  services NestJS, dont la DI repose sur `emitDecoratorMetadata` (l'élision des
  imports type casserait l'injection).

Principes :

- **Rendre les états invalides irreprésentables.** Unions discriminées plutôt que
  props optionnelles contradictoires ; `switch` exhaustif gardé par `never`.
- **« Parse, don't validate ».** Aux frontières (HTTP, événements, DB, formulaires)
  on _parse_ avec Zod vers un type de domaine — on ne valide pas un `any` qu'on
  caste ensuite.
- **Types brandés** pour les identités primitives (cf. `Brand`/`brander` dans
  [`shared-kernel`](libs/shared-kernel/src/lib/branded.ts), et `.brand()` Zod dans
  les contrats — ex. `FoyerId`/`EnfantId`). Un `FoyerId` reste un `string` mais un
  `string` brut n'est pas un `FoyerId`. Coût runtime nul.
- **Immutabilité** : `readonly`, `ReadonlyArray`, `as const`. Éviter `as`
  (assertions) — privilégier l'inférence et les type guards.
- Pas de préfixe `I` sur les interfaces ; pas de `enum` (préférer `as const`).

## 2. React 19 (`apps/web`)

- **React Compiler** activé via `babel-plugin-react-compiler`
  ([`vite.config.mts`](apps/web/vite.config.mts)) : mémoïsation automatique.
  **Ne plus ajouter `useMemo`/`useCallback`/`memo` par défaut** — uniquement
  après profilage. La mémoïsation manuelle **existante** ne se retire pas à
  l'aveugle : la règle `react-hooks/preserve-manual-memoization` signale les cas
  où le Compiler ne peut pas la préserver (cf. §3).
- Les diagnostics du Compiler (code non compilable / non sûr pour la mémoïsation
  auto) sont **enforcés au lint** par `eslint-plugin-react-hooks` v7 — voir §3
  pour le partage erreur/warn.
- Pas de `React.FC` : typer directement l'argument `props`. Props majoritairement
  requises.
- Data-fetching : hook `use()` + Suspense plutôt que `useEffect` + `useState`.
  Formulaires : `useActionState` ; feedback optimiste : `useOptimistic`.
- Accessibilité vérifiée au lint (`jsx-a11y`) et en e2e (axe AA).

## 3. ESLint (flat config, type-aware)

ESLint 9 + flat config + `typescript-eslint` v8 en `strictTypeChecked` +
`stylisticTypeChecked` (lint **type-aware** via `projectService`). Voir
[`eslint.config.mjs`](eslint.config.mjs).

- Règles **anti-bug en erreur** : `no-floating-promises`, `no-misused-promises`,
  `await-thenable`, + toutes les règles strictes auto-corrigeables (array-type,
  no-unnecessary-type-assertion, no-confusing-void-expression, etc.).
- Règles du **React Compiler** (eslint-plugin-react-hooks v7,
  `recommended-latest`) actives sur `**/*.{jsx,tsx}` :
  - en **erreur** : `rules-of-hooks`, `static-components`, `use-memo`, `purity`,
    `set-state-in-render`… ;
  - **ratchetées en `warn`** ([`eslint.config.mjs`](eslint.config.mjs), bloc
    `// TODO ratchet`) : `set-state-in-effect`, `refs`,
    `preserve-manual-memoization`, `immutability` — diagnostics sur du code
    existant qui fonctionne (tests verts), consultatifs le temps de les traiter
    sans régression — plus `exhaustive-deps` (autofix jugé risqué par React).
    **Intention : remonter chacune en `error`** au fil des corrections.
- **Ratchet TypeScript (`warn` → `error`)** : règles temporairement en `warn`,
  marquées `// TODO ratchet` dans [`eslint.config.mjs`](eslint.config.mjs), en
  trois familles : (1) code tiers non typé — `no-unsafe-*`, `no-explicit-any`,
  `restrict-template-expressions`/`-plus-operands`… ; (2) faux positifs de
  patterns légitimes du repo — `no-useless-constructor`, `no-extraneous-class`,
  `no-unnecessary-condition`, `unbound-method`… ; (3) signaux informatifs —
  `no-deprecated`, `require-await`, `no-unused-vars`… À remonter en `error`
  lib par lib.
- **Frontières d'architecture** : `@nx/enforce-module-boundaries` (tags `type:` /
  `context:`) — un contexte ne dépend que de ses dépendances déclarées.

Notes d'implémentation :

- La couche React et l'exclusion des tests web du lint type-aware sont déclarées
  dans le **root** `eslint.config.mjs` (globs `**/*.{jsx,tsx}` et
  `**/*.test.{ts,tsx}`, propres à web) afin de s'appliquer aussi sous lint-staged,
  qui lance `eslint` depuis la racine sans cascade par dossier (flat config).
- Les fichiers hors programme TS (specs e2e, `*.config.ts`) sont lintés sans
  `projectService`.

## 4. Tests & qualité

- Vitest 4 (+ coverage v8 : 100 % sur les libs domaine, seuils **ratchet** sur
  les services et le web), property testing (fast-check, `*.mbt.spec.ts`),
  mutation testing (Stryker sur les 4 libs domaine, workflow `mutation.yml`),
  e2e Playwright + axe.
- Convention de nommage : `*.test.ts(x)` côté `apps/web`, `*.spec.ts` côté
  services/libs.
- Piège : `nx test <projet>` ne **type-check pas** (Vitest transpile sans
  vérifier les types). Pour valider un changement : `pnpm nx run-many -t
typecheck test -p <projet>`.

## 5. Outillage évalué mais différé

`type-coverage` et `knip` ont été évalués : tous deux nécessitent une
configuration spécifique à la structure « solution » d'Nx (type-coverage ne voit
aucun fichier sans tsconfig racine agrégé ; knip produit beaucoup de faux
positifs sur les déps chargées au runtime et les `webpack.config.js`). Reportés
tant qu'une config Nx dédiée n'est pas écrite — la sûreté de type est déjà
garantie par le tsconfig strict et le lint type-aware.
