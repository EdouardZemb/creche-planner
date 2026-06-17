# ADR-0003 — Décisions de toolchain (Phase 1)

- **Statut** : Accepté
- **Date** : 2026-06-02
- **Contexte amont** : [ADR-0001](0001-architecture-microservices.md), [ADR-0002](0002-grain-services-et-politiques-tarifaires.md)

## Contexte

La mise en place du socle (Phase 1) sur **Windows + Nx 22 (setup « TS solution »)** a imposé
plusieurs choix non évidents pour que `lint/typecheck/test/build` et `docker compose up` soient
verts et reproductibles. On les consigne pour ne pas les redécouvrir (ni les casser) en Phase 2+.

## Décisions

1. **Node 24 LTS** (et non 22). `winget OpenJS.NodeJS.LTS` installe la LTS courante = 24 ;
   `.nvmrc=24`, `engines.node >= 22`.
2. **Linker pnpm isolé** (défaut), pas `hoisted`. Le mode hoisted casse la résolution interne de
   Nx (`nx/node_modules/minimatch`) et le binding natif de Vitest. `.npmrc` :
   `strict-peer-dependencies=false`, `auto-install-peers=true`.
3. **Vitest 3.2 / Vite 6 (esbuild)**, épinglés. Vitest 4 / Vite 8 embarquent **rolldown**, dont le
   binding natif Windows (`@rolldown/binding-win32-x64-msvc`) ne se lie pas de façon fiable
   (`Cannot find native binding`). Vitest 3 (esbuild) est stable.
4. **`@nx/js:typescript-sync` désactivé** (`nx.json` → `sync.disabledTaskSyncGenerators`). Bug
   Nx+pnpm : le générateur construit un chemin en dur `node_modules/nx/node_modules/minimatch`
   inexistant sous pnpm. Les références tsconfig sont gérées par les générateurs eux-mêmes.
5. **Build webpack des apps → résolution SOURCE des libs**. Dans chaque `webpack.config.js` :
   `resolve.conditionNames = ['@creche-planner/source', 'import', 'require', 'node', 'default']`
   **et** retrait de `rootDir` dans `tsconfig.app.json`. Sinon webpack tire le `dist` compilé des
   libs dans le programme ts-loader → `TS6059 rootDir`.
6. **Ignore `node_modules` par projet**. Chaque `.eslintrc.json` de projet ajoute
   `**/node_modules` à `ignorePatterns` (après le `!**/*` généré), sinon ESLint lint les libs
   symlinkées dans les `node_modules` du projet.
7. **Imports relatifs en `.js`** dans le TS (`moduleResolution: nodenext`) — obligatoire au build.
8. **dépendances directes uniquement** dans les `package.json` de projet (règle
   `@nx/dependency-checks`) : ne déclarer que ce qui est réellement importé.

## Conséquences

- Reproductible sur Windows ; `nx run-many -t lint typecheck test build` et `docker compose up`
  fonctionnent. Le détail est commenté dans les fichiers concernés (`.npmrc`, `nx.json`,
  `webpack.config.js`, `vitest.config.mts`, `.eslintrc.json`).
- Ces choix sont **internes au tooling** : aucun impact sur l'architecture (ADR-0001/0002) ni le
  domaine métier. Révisables si l'écosystème se stabilise (ex. revenir à Vitest 4 quand le binding
  rolldown Windows sera fiable).

## Note d'exploitation (hors décision)

Les crashes Docker Desktop rencontrés (exec format error, Secrets Engine, SIGBUS) provenaient d'un
**disque saturé (0 octet libre)**, pas de la configuration. Garder de la marge disque.
