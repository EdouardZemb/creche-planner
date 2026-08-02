---
name: code-conventions-strict
description: Setup ESLint flat config type-aware + tsconfig strict + branded types du monorepo creche-planner
metadata:
  node_type: memory
  type: project
  originSessionId: 901781ba-9871-493a-967a-ae9d9f13bfbc
---

Conventions « exigeantes » outillées (juin 2026), documentées dans `CONVENTIONS.md`.

- **ESLint** : flat config (`eslint.config.mjs`), ESLint 9 + `typescript-eslint` v8
  en `strictTypeChecked` + `stylisticTypeChecked` (type-aware via `projectService`).
  Beaucoup de règles bruyantes/faux-positifs sont en `warn` avec `// TODO ratchet`
  (à remonter en `error` lib par lib) ; les anti-bug (no-floating-promises…) et le
  gros des règles strictes sont en `error`.
- **Piège flat config + lint-staged** : la couche React (react/react-hooks v7/
  jsx-a11y) ET l'exclusion des tests web du lint type-aware sont déclarées dans le
  **root** `eslint.config.mjs` (globs `**/*.{jsx,tsx}`, `**/*.test.{ts,tsx}`,
  web-only), PAS dans `apps/web/eslint.config.mjs` — sinon lint-staged (qui lance
  eslint depuis la racine, sans cascade par dossier) ne les applique pas et casse.
  `tsconfigRootDir` est fixé globalement (requis par ts-eslint v8).
- **Tests web** (`*.test.ts(x)`, web-only ; services/libs utilisent `*.spec.ts`)
  exclus du lint type-aware : le `projectService` résout mal les types DOM dans le
  tsconfig « solution » → autofixes destructifs sur les casts `as HTMLInputElement`.
- **tsconfig** : `verbatimModuleSyntax` activé sur `apps/web` UNIQUEMENT (la DI
  NestJS via `emitDecoratorMetadata` casse avec l'élision des imports type).
- **Branded types** : `Brand`/`brander` dans `shared-kernel` ; IDs de contrats
  brandés via Zod `.brand()` (`FoyerId`/`EnfantId`), parse à la frontière côté
  producteur (`foyerIdSchema.parse`).
- `type-coverage` / `knip` évalués puis différés (config Nx « solution » à écrire).

Voir [[repo-clean-clone-location]] (main protégée, PR + check `ci`) et
[[pnpm-corepack-version]].
