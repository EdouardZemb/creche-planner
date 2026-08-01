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

## Amendement — 2026-08-01 : la sortie `tsc` des apps quitte `dist/`

- **Statut** : Accepté

**Contexte.** Depuis le lot B2 (PR #268), `test` dépend de `build` **et** de `typecheck`, sans aucune
arête d'ordre entre les deux : Nx les exécute donc **en parallèle**. Or `tsconfig.app.json` émettait
ses déclarations dans `apps/<app>/dist`, c'est-à-dire le répertoire que `webpack.config.js` déclare
en `output.path` **avec `clean: true`** — donc efface. Les deux tâches écrivaient dans le même
dossier, sans se connaître. En temps normal le cache Nx sert au moins l'une des deux et la course ne
se produit pas ; le commit de publication du 2026-08-01 (bump de version des 7 `package.json`) a
invalidé le cache de tous les projets, d'où le premier build à froid complet depuis #268 et la
défaillance : `ENOTEMPTY: directory not empty, rmdir …/dist/src/bff` côté webpack, puis une trentaine
de `TS6305 Output file … has not been built from source file …` côté tsc — effet, pas cause.

**Décision.** 9. **Sortie `tsc` des apps hors de `dist/`.** `tsconfig.app.json` émet dans
`./out-tsc/app` (`outDir` **et** `tsBuildInfoFile`), en suivant la convention déjà en place pour
`tsconfig.spec.json` (`./out-tsc/vitest`). `dist/` redevient la propriété exclusive de webpack : le
bundle déployable qu'attendent le Dockerfile, les specs Pact provider (`resolve(RACINE,
'apps/<app>/dist/main.js')`) et les cibles `prune-lockfile`/`copy-workspace-modules`.

**Alternative écartée.** Forcer une arête d'ordre (`build.dependsOn: ["typecheck"]`) : cela sérialise
le graphe donc le ralentit, et laisse webpack effacer ensuite des sorties que Nx vient de mettre en
cache pour `typecheck`. Le conflit d'écriture disparaîtrait, la propriété partagée du répertoire —
la vraie cause — resterait.

**Conséquence.** `typecheck` et `build` n'ont plus aucun fichier en commun (vérifiable par
`nx show project <app> --json` : les `outputs` des deux cibles sont disjoints). `out-tsc` est déjà
couvert par `.gitignore` et `.dockerignore` : rien d'autre à ajuster.

## Note d'exploitation (hors décision)

Les crashes Docker Desktop rencontrés (exec format error, Secrets Engine, SIGBUS) provenaient d'un
**disque saturé (0 octet libre)**, pas de la configuration. Garder de la marge disque.
