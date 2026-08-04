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
- **`git fetch` avant de brancher** : le préflight est hors-réseau par
  construction, il ne peut pas voir un `origin/main` périmé.
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
