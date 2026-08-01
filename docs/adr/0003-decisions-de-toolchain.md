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

## Amendement — 2026-08-01 (bis) : les 14 libs ne sont **pas** concernées (question tranchée par la mesure)

- **Statut** : Accepté — **aucun changement de configuration**

**La question.** Les libs présentent le même recouvrement _apparent_ que les apps :
`tsconfig.lib.json` déclare `"outDir": "dist"` et `"tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo"` ;
la cible `build` lance `tsc --build tsconfig.lib.json` ; la cible `typecheck` lance
`tsc --build tsconfig.json`, dont les `references` incluent `./tsconfig.lib.json` — donc le **même**
sous-projet, donc le **même** `.tsbuildinfo`. La PR #273 ayant volontairement laissé les libs de côté,
la question devait être tranchée. **Elle l'est : le risque n'existe pas, et il ne faut rien changer.**

**Pourquoi les libs diffèrent des apps.** C'est l'origine de la cible `build` qui change tout :

|      | `build`                                               | `typecheck.dependsOn`                            |
| ---- | ----------------------------------------------------- | ------------------------------------------------ |
| apps | `webpack-cli build` (`@nx/webpack`)                   | `["^typecheck"]` — **aucune arête vers `build`** |
| libs | `tsc --build tsconfig.lib.json` (`@nx/js/typescript`) | `["build", "^typecheck"]`                        |

Sur les libs, `@nx/js/typescript` **produit les deux cibles** et sait donc qu'elles se recouvrent : il
pose lui-même l'arête d'ordre. Sur les apps, le plugin ne voit qu'une cible `build` webpack qui ne lui
appartient pas — il ne peut rien poser, d'où #273. L'arête est vérifiable sur le graphe de tâches
(`nx run-many -t typecheck build -p <libs> --graph=g.json` → `"<lib>:typecheck": ["<lib>:build"]`,
`roots: ["<lib>:build", …]`). **Nx ne planifie donc jamais les deux en parallèle**, y compris en CI,
qui n'utilise qu'une seule invocation (`nx affected -t lint typecheck test build --parallel=3`).

**Ce qui a été mesuré** (Windows, `--parallel=16`, `dist/` et `*.tsbuildinfo` effacés à chaque fois) :

1. **Passe nominale** — `nx reset` puis 5 itérations à froid d'affilée de
   `nx run-many -t typecheck build -p <les 14 libs> --skip-nx-cache --parallel=16` : **5/5 vertes**.
2. **`outputs` déclarés disjoints** — `build` → `{projectRoot}/dist/**` + `dist/tsconfig.lib.tsbuildinfo` ;
   `typecheck` → `{projectRoot}/tsconfig.tsbuildinfo` seul. Contrairement à l'attendu, **il n'y a pas de
   recouvrement déclaré**.
3. **Écritures réelles** — `typecheck` seul, à froid, écrit bel et bien dans `dist/` (les `.d.ts`,
   `.d.ts.map` et `dist/tsconfig.lib.tsbuildinfo`) : ses `outputs` Nx sous-déclarent ce qu'il _peut_
   écrire. Mais dans l'ordre réel (`build` puis `typecheck`), il **n'écrit rien** : `dist/` reste
   identique bit à bit, mtimes inchangés. Idem après restauration de `build` depuis le cache Nx.
4. **Contrôle adversarial** — les deux `tsc` lancés _simultanément_ hors Nx, 8 itérations × 4 libs :
   32/32 en `exit 0`, `.js`/`.d.ts` **identiques bit à bit** à un build série. Seul
   `dist/tsconfig.lib.tsbuildinfo` diffère, et `tsc --build --dry` répond alors « would build » au lieu
   de « up to date » : **dégradation** (marqueur d'à-jour perdu → un rebuild inutile), **pas corruption**
   — le build suivant réémet correctement.
5. **Ordre inverse** (`typecheck` puis `build`) — `tsc` détecte les `.js` manquants et les réémet
   (7/7). L'état « déclarations seules » ne trompe pas un build complet : pas de court-circuit.

**Décision.** Ne rien changer aux 14 `tsconfig.lib.json`. Le `dist/` des libs est une **vraie sortie
consommée** — `require.resolve('@creche-planner/shared-kernel')` depuis une app résout bien
`libs/shared-kernel/dist/index.js` (la condition `@creche-planner/source` ne s'applique qu'au build
webpack et à Vite), et `copy-workspace-modules` empaquette ces `dist` dans l'image. Le déplacer serait
invasif, pour un risque que la mesure ne trouve pas. Et surtout : les deux producteurs sont `tsc`,
aucun ne fait de `clean` — la propriété partagée du répertoire, vraie cause côté apps, n'a pas
d'équivalent ici.

**Quand rouvrir la question.** L'innocuité tient à l'arête posée par `@nx/js/typescript`, pas à une
propriété intrinsèque. Rouvrir si l'une de ces conditions change :

- la cible `build` d'une lib passe à un exécuteur non-`tsc` (webpack, tsup, rollup…) — le plugin
  cesserait de poser l'arête, exactement le scénario des apps ;
- `configName` (`nx.json` → plugin `@nx/js/typescript`) ne pointe plus vers `tsconfig.lib.json`, ou le
  plugin cesse d'inférer `build` pour les libs ;
- un producteur qui **nettoie** son répertoire de sortie apparaît dans la chaîne.

Reste vrai dans tous les cas : **deux invocations Nx concurrentes sur le même worktree** sortent du
graphe de tâches et ne sont couvertes par aucune arête — ce qui vaut pour toutes les cibles, pas
seulement celles-ci.

## Note d'exploitation (hors décision)

Les crashes Docker Desktop rencontrés (exec format error, Secrets Engine, SIGBUS) provenaient d'un
**disque saturé (0 octet libre)**, pas de la configuration. Garder de la marge disque.
