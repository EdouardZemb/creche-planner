---
name: dep-react-router-v7-migration
description: Migration react-router-dom v6→v7 (Dependabot
metadata:
  node_type: memory
  type: project
  originSessionId: 62a828fe-a2ea-4e63-9a1b-fb7ba1ef69e6
---

Résolution de la PR Dependabot #35 (`react-router-dom` 6.30.4 → 7.18.1) : #35 **fermée** (simple bump, CI `ci` rouge car code web non adapté) et remplacée par la PR de migration [#149](https://github.com/EdouardZemb/creche-planner/pull/149) — **✅ MERGÉE main `ce079d6` (squash, 2026-07-03)**, branche supprimée, CI 100% verte (dont `ci`, `e2e-web`, `e2e-stack`, `pact-can-i-deploy`). Non déployée en prod (dep front only, pas de train dédié — partira au prochain release train).

**Constat clé** : `apps/web` n'utilise que l'API **déclarative** (`BrowserRouter`/`Routes`/`Route`/`Navigate`/`NavLink`/`Outlet`/`useParams`/`useSearchParams`/`useNavigate`/`useLocation`/`useMatch`). En v7, `react-router-dom` réexporte tout depuis `react-router` → **imports et routing inchangés**. Pas de data router (`createBrowserRouter`/loaders/actions), pas de render-props `NavLink`, pas de `json`/`defer` → rien à réécrire.

**Seul breaking change effectif** : `navigate()` renvoie désormais une `Promise<void>` (était `void` en v6) → `@typescript-eslint/no-floating-promises` déclenche 3 erreurs (`FoyerFormPage.tsx`, `FoyerModifierPage.tsx` ×2). Fix = préfixer `void navigate(...)` (idiome déjà en place : `onSubmit={(ev) => void soumettre(ev)}`).

**Pièges worktree rencontrés** (cf. [feature-dashboard-jour]) : les libs workspace `@creche-planner/contracts-kernel` / `@creche-planner/shared-semaine` résolvent via la condition d'export `@creche-planner/source`→`src/index.ts` MAIS la config vitest web ne pose pas cette condition → vite tombe sur `./dist/index.js` **inexistant** si les libs ne sont pas bâties. Symptôme : 2 suites « Failed to resolve import @creche-planner/… » (openapi-types.spec, DashboardJourPage.test — les 2 seuls specs web qui importent ces libs). **Fix worktree** : `nx run-many -t build -p contracts-kernel shared-semaine` d'abord (le pipeline complet le fait via les deps). Rien à voir avec react-router. Validé ensuite : lint/typecheck/test(457)/build/e2e(12) verts.
