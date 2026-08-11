# Contribuer

Point d'entrée court. Les références détaillées : [CONVENTIONS.md](CONVENTIONS.md)
(conventions TS/React outillées), [doc 03](docs/03-standards-developpement.md)
(standards complets) et l'[index de la documentation](docs/README.md).

## Prérequis

- **Node 24 LTS** — version figée dans [`.nvmrc`](.nvmrc).
- **pnpm via corepack uniquement** : `corepack pnpm@10.34.2 …` (la version est
  pilotée par le champ `packageManager` de `package.json`). Ne pas utiliser un
  pnpm installé globalement — un pnpm 8.x régénérerait un lockfile incompatible.
- **Docker Desktop** — requis seulement pour la pile locale et les e2e stack.

## Commandes de base

```bash
corepack pnpm install

# Préflight (~6 s, aucun accès réseau) : pnpm/Node attendus, clone principal ou
# worktree, symlinks `workspace:*`, shims .bin, chaîne Nx alignée, ports des
# providers Pact libres, hooks husky.
# À lancer en début de session, et dès qu'un comportement devient inexplicable.
corepack pnpm preflight
# ⚠️ `pnpm doctor` NE lance PAS ce script : `doctor` est une sous-commande native de pnpm.

# Qualité (lint + type-check + tests + build sur les projets affectés)
corepack pnpm nx run-many -t lint typecheck test build

# Frontières Nx + miroirs de vocabulaire (< 1 s, step bloquant du job `ci`).
# À lancer après tout ajout de projet, de tag `context:`, ou de recopie d'un
# vocabulaire partagé — cf. CONVENTIONS.md §4.
corepack pnpm frontieres

# Pièges morts recopiés dans un plan ou une doc (< 1 s, step bloquant du job `ci`).
# Cf. la section « Pièges » ci-dessous.
corepack pnpm pieges

# Documentation (< 1 s, steps bloquants du job `ci`, cf. doc 35) :
# `liens` = liens internes et ancres morts ; `faits` = valeurs citées qui
# contredisent leur source (version coupée, projets Nx, ports, chaîne d'outils).
corepack pnpm liens
corepack pnpm faits
corepack pnpm statuts        # statut daté en tête de chaque document de docs/
corepack pnpm tracabilite    # exigences CT/UT ↔ tests, dans les deux sens

# Un seul projet : `nx test <projet>` déclenche désormais son `typecheck` et le
# build des libs dont il dépend (`targetDefaults` de nx.json + `dependsOn` des
# cibles écrites à la main). Plus besoin de builder les libs à la main.
corepack pnpm nx test web

# Pile locale complète / E2E stack réelle
docker compose up --build
corepack pnpm e2e:stack
```

## Pièges : ce que l’outillage garantit

Cette section est la **source unique** sur la boucle de dev. Les plans et les
docs n’ont pas à la recopier : `pnpm pieges` refuse en CI la réapparition d’un
piège de la première liste (registre dans `scripts/verifier-pieges-doc.mjs`).

**Neutralisés — ne plus les documenter, ne plus les contourner à la main :**

| Piège                                                                                           | Ce qui le rend impossible                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Worktree « faux vert » (éditer le clone principal par accident), worktree sans `node_modules`   | `pnpm preflight` compare `git-dir` à `git-common-dir` et **nomme** le worktree courant                       |
| Symlinks `workspace:*` cassés (`pnpm install --force` depuis PowerShell)                        | `pnpm preflight` vérifie chaque lien là où il vit : le `node_modules` de **chaque** projet, jamais la racine |
| Shims `.bin` périmés après un `pnpm install`                                                    | `pnpm preflight` vérifie que chaque shim pointe une cible existante                                          |
| Un process fantôme squatte un port de provider Pact (3995-3999)                                 | `pnpm preflight` refuse de conclure si un des 5 ports est tenu                                               |
| pnpm global 8.x / Node hors `.nvmrc`                                                            | `pnpm preflight` compare au champ `packageManager` et à `.nvmrc`                                             |
| `nx test web` ne type-checke pas                                                                | `test` porte `dependsOn: ["^build", "typecheck"]` (lot B2)                                                   |
| Builder `contracts-kernel`/`shared-semaine` avant les tests, le type-check, l’e2e ou un `serve` | l’arête `^build` est portée par `test`, `typecheck`, `e2e`, `build`, `serve`, `dev` et `preview`             |
| Course `dist/` entre `build` et `typecheck` (`ENOTEMPTY` puis cascade `TS6305`)                 | les `tsconfig.app.json` émettent dans `./out-tsc/app`, plus dans le `dist/` que webpack efface               |
| Contexte Nx jamais contraint, miroir de vocabulaire divergent                                   | `pnpm frontieres` (cf. [CONVENTIONS.md §4](CONVENTIONS.md))                                                  |
| Warnings ESLint qui remontent en silence                                                        | `lint-baseline.json` versionnée, step bloquant du job `ci`                                                   |
| Lien interne mort (fichier déplacé, titre renommé — l'ancre suit le titre)                      | `pnpm liens` (cf. [doc 35](docs/35-politique-documentation.md))                                              |
| Fait recopié qui dérive de sa source (version coupée, projets, ports, chaîne d'outils)          | `pnpm faits` (idem)                                                                                          |
| Document sans statut ni date : « est-ce que ça vaut encore ? » sans réponse                     | `pnpm statuts` (idem)                                                                                        |
| Exigence `CT`/`UT` sans test qui la nomme, ou test citant une exigence disparue                 | `pnpm tracabilite` (idem)                                                                                    |

> `pnpm preflight` **détecte et nomme**, il ne répare pas. Pour les trois
> premières lignes, le remède est le même : relancer `corepack pnpm install`
> (avec `--force` si un lien reste cassé) — **depuis PowerShell sous Windows**,
> jamais Git Bash, la création des liens y échoue silencieusement. Ce qui a
> disparu, c'est d'avoir à deviner lequel des trois est en cause.

**Encore réels — à connaître, aucun outil ne les couvre :**

- **`nx run-many -t test --all --parallel` : les 5 tests provider Pact ouvrent un
  port fixe.** Le préflight écarte le port squatté, mais **le même message**
  (« provider non prêt après 40000 ms ») recouvre un second mode d’échec que
  rien ne peut détecter d’avance : la **saturation machine** (231 s rien qu’en
  imports sous `--parallel=3`). En local, `--parallel=1` pour un verdict fiable.
- **Ne jamais retirer `/pacts` de `.prettierignore`** — lint-staged casserait
  `pact-drift`.
- **Migrations drizzle : `drop` vs `rename` se décide dans un prompt TTY** qu’un
  agent ne voit pas ⇒ procédure en 2 passes, cf.
  [doc 09](docs/09-spec-decouplage-microservices.md).
- **`prettier --check` échoue sur _tous_ les fichiers sous Windows**
  (`core.autocrlf` ⇒ CRLF sur disque, `endOfLine: lf` côté prettier). La seule
  mesure probante est `nx format:check --base=origin/main --head=HEAD`.
- **`pnpm liens` est rouge en permanence sous Windows, et ce rouge-là ne veut
  rien dire.** Même cause : le script découpe sur `\n` seul, donc il n'extrait
  aucune ancre d'un fichier à fins de ligne CRLF et déclare mortes toutes celles
  qui le visent (une vingtaine d'erreurs sur un arbre intact). **Mais la
  frontière est nette** : le hook de formatage post-édition réécrit en LF tout
  fichier qu'on touche, donc les fichiers du **diff en cours** sont exactement
  ceux que la porte sait juger. Lire sa sortie **fichier par fichier** — une
  erreur sur un fichier du diff est réelle, une erreur sur un fichier non touché
  est du bruit — et laisser la CI (checkout LF) juger l'ensemble. Ne pas en
  conclure que la porte est cassée : c'est ainsi qu'on cesse de la lire.
- **`git fetch` avant de brancher** : le préflight est hors-réseau par
  construction, il ne peut pas voir un `origin/main` périmé.
- **Le ratchet ESLint (`lint-warnings.mjs`) ne tourne pas sous Windows : c'est une
  porte de CI seulement.** Il lint le dépôt ENTIER dans un seul processus ; sur ce
  poste il épuise le tas et meurt en `FATAL ERROR: JavaScript heap out of memory`
  — mesuré trois fois, jusqu'à **8 Go de tas et 28 min** avant l'abandon, y compris
  avec `--max-old-space-size`. Le **même step passe en ~3 min sur le runner Linux**.
  Ne pas chercher à le faire aboutir en local, et surtout ne pas en conclure que la
  baseline est cassée. Mesure locale utile à la place : `nx run <projet>:lint` sur
  les projets touchés — s'ils n'introduisent aucun warning, le total ne peut pas
  monter.
- **Un `| tail` masque le code de sortie** (c’est celui de `tail`) : une suite
  entière a déjà été lue « verte » alors que 7 cibles échouaient.
- **UI** : la suite axe ne voit ni le focus, ni les bordures de champ, ni
  `:disabled`, ni l’`opacity` d’un ancêtre. Pour toute refonte de style,
  `nx run web:e2e-visuel` puis `node scripts/comparer-empreinte.mjs` — empreinte
  des styles **calculés**, hors CI (outil de revue, pas une porte). Deux limites :
  elle est mesurée à l’écran (pas `@media print`), et une mesure qui n’a rien
  mesuré rend « 0 constat », indiscernable d’un succès.

## Workflow PR

1. **`main` est protégée** : aucune modification directe. Une branche dédiée par
   sujet → PR → merge quand le check **`ci`** est vert (requis par la protection
   de branche).
2. **Commits conventionnels, en français** : `feat(...)`, `fix(...)`, `docs(...)`,
   `chore(...)`… — vérifiés par commitlint au pre-commit (husky + lint-staged,
   qui applique aussi prettier/eslint sur les fichiers stagés).
3. **Une PR = un sujet.** La spec précède le code : toute fonctionnalité
   substantielle commence par une doc dans [`docs/`](docs/README.md).
4. Vulnérabilités : voir [SECURITY.md](SECURITY.md) (ne pas ouvrir d'issue publique).
