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

# Complétude de l'export de portabilité (< 1 s, step bloquant du job `ci`,
# cf. doc 37 §6) : toute table déclarée par un service doit être classée —
# exportée, copie d'une table elle-même exportée, technique, ou hors périmètre.
# À lancer après tout ajout de table.
corepack pnpm portabilite

# Configuration d'environnement (< 1 s, step bloquant du job `ci`, cf. AM-44) :
# chaque app déclare dans son `config.ts` un `CHAMPS_ENV` qui EST l'inventaire des
# variables qu'elle lit. La porte refuse une lecture de `process.env` faite hors de
# ce fichier, un réglage de compose que personne ne lit, et une variable déclarée
# sans ligne de compose ni motif écrit. À lancer après tout ajout de variable
# d'environnement, des deux côtés (schéma ou compose).
corepack pnpm environnement

# Durcissement des conteneurs (< 1 s, step bloquant du job `ci`, cf. AM-48) :
# tout service des trois piles Compose tourne en `no-new-privileges` +
# `cap_drop: [ALL]`, racine en lecture seule sauf exemption motivée dans le
# script, et toute capacité reprise y est nommée. À lancer après tout ajout de
# service ou modification de posture. ⚠️ La porte ne prouve PAS que la pile
# démarre, et encore moins qu'elle REDÉMARRE : le jeu de capacités minimal de
# Postgres passe le premier boot et meurt au second (`LE-53`). Un changement de
# durcissement se vérifie sur la pile réelle, redémarrage compris.
corepack pnpm conteneurs

# Quarantaine des publications npm (< 1 s, step bloquant du job `ci`, cf. AM-50) :
# le délai avant d'installer une version fraîchement publiée doit être déclaré
# dans `pnpm-workspace.yaml` (jamais dans `.npmrc`, ignoré en silence depuis la
# version 10.16 de pnpm) et rester égal au `cooldown` de Dependabot.
corepack pnpm quarantaine

# Empêchements d'outillage (< 1 s, step bloquant du job `ci`, cf. doc 34 §6) :
# chaque piège « encore réel » de la section ci-dessous doit porter sa ligne
# `EM-xx` au registre — avec son remède, ou un renoncement daté.
corepack pnpm empechements

# Documentation (< 1 s, steps bloquants du job `ci`, cf. doc 35) :
# `liens` = liens internes et ancres morts ; `faits` = valeurs citées qui
# contredisent leur source (version coupée, projets Nx, ports, chaîne d'outils).
corepack pnpm liens
corepack pnpm faits
corepack pnpm readme         # fraîcheur du README : portes de CI, ADR, lots livrés, docs/
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

| Piège                                                                                           | Ce qui le rend impossible                                                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Worktree « faux vert » (éditer le clone principal par accident), worktree sans `node_modules`   | `pnpm preflight` compare `git-dir` à `git-common-dir` et **nomme** le worktree courant                                      |
| Symlinks `workspace:*` cassés (`pnpm install --force` depuis PowerShell)                        | `pnpm preflight` vérifie chaque lien là où il vit : le `node_modules` de **chaque** projet, jamais la racine                |
| Shims `.bin` périmés après un `pnpm install`                                                    | `pnpm preflight` vérifie que chaque shim pointe une cible existante                                                         |
| Un process fantôme squatte un port de provider Pact (3995-3999)                                 | `pnpm preflight` refuse de conclure si un des 5 ports est tenu                                                              |
| pnpm global 8.x / Node hors `.nvmrc`                                                            | `pnpm preflight` compare au champ `packageManager` et à `.nvmrc`                                                            |
| `nx test web` ne type-checke pas                                                                | `test` porte `dependsOn: ["^build", "typecheck"]` (lot B2)                                                                  |
| Builder `contracts-kernel`/`shared-semaine` avant les tests, le type-check, l’e2e ou un `serve` | l’arête `^build` est portée par `test`, `typecheck`, `e2e`, `build`, `serve`, `dev` et `preview`                            |
| Course `dist/` entre `build` et `typecheck` (`ENOTEMPTY` puis cascade `TS6305`)                 | les `tsconfig.app.json` émettent dans `./out-tsc/app`, plus dans le `dist/` que webpack efface                              |
| Contexte Nx jamais contraint, miroir de vocabulaire divergent                                   | `pnpm frontieres` (cf. [CONVENTIONS.md §4](CONVENTIONS.md))                                                                 |
| Warnings ESLint qui remontent en silence                                                        | `lint-baseline.json` versionnée, step bloquant du job `ci`                                                                  |
| Lien interne mort (fichier déplacé, titre renommé — l'ancre suit le titre)                      | `pnpm liens` (cf. [doc 35](docs/35-politique-documentation.md))                                                             |
| Fait recopié qui dérive de sa source (version coupée, projets, ports, chaîne d'outils)          | `pnpm faits` (idem)                                                                                                         |
| README qui prend du retard sur le dépôt (porte de CI, ADR, lot livré, section de `docs/`)       | `pnpm readme` (idem) — il ne juge pas la prose, cf. son périmètre déclaré en [doc 34 §5](docs/34-registre-ameliorations.md) |
| Document sans statut ni date : « est-ce que ça vaut encore ? » sans réponse                     | `pnpm statuts` (idem)                                                                                                       |
| Exigence `CT`/`UT` sans test qui la nomme, ou test citant une exigence disparue                 | `pnpm tracabilite` (idem)                                                                                                   |

> `pnpm preflight` **détecte et nomme**, il ne répare pas. Pour les trois
> premières lignes, le remède est le même : relancer `corepack pnpm install`
> (avec `--force` si un lien reste cassé) — **depuis PowerShell sous Windows**,
> jamais Git Bash, la création des liens y échoue silencieusement. Ce qui a
> disparu, c'est d'avoir à deviner lequel des trois est en cause.

**Encore réels — à connaître, aucun outil ne les couvre :**

Chaque entrée porte son identifiant `EM-xx` au registre
([doc 34 §6](docs/34-registre-ameliorations.md#6-empêchements-doutillage--em-xx)) : cette liste
**ne peut plus s'allonger sans mettre le remède en file**, ou sans écrire pourquoi il n'y en aura
pas. La porte `pnpm empechements` dérive la liste attendue de ce fichier et refuse une entrée
orpheline — c'est ce qui empêche « à connaître » de redevenir « pour toujours ».

- **`nx run-many -t test --all --parallel` : les 5 tests provider Pact ouvrent un
  port fixe.** (`EM-04`) Le préflight écarte le port squatté, mais **le même message**
  (« provider non prêt après 40000 ms ») recouvre un second mode d’échec que
  rien ne peut détecter d’avance : la **saturation machine** (231 s rien qu’en
  imports sous `--parallel=3`). En local, `--parallel=1` pour un verdict fiable.
- **Deux sessions ne partagent jamais un clone : une session = un worktree.**
  (`EM-21`) `git add -A` (ou un `git stash pop` pendant un rebase) dans un arbre
  partagé emporte le travail de l'autre session dans la mauvaise PR — c'est
  arrivé. Ouvrir `git worktree add`, et construire l'index par **chemins
  explicites**.
- **Ne jamais retirer `/pacts` de `.prettierignore`** (`EM-05`) — lint-staged
  casserait `pact-drift`.
- **Migrations drizzle : `drop` vs `rename` se décide dans un prompt TTY**
  (`EM-06`) qu’un agent ne voit pas ⇒ procédure en 2 passes, cf.
  [doc 09](docs/09-spec-decouplage-microservices.md).
- **`prettier --check` échoue sur _tous_ les fichiers sous Windows** (`EM-07`)
  (`core.autocrlf` ⇒ CRLF sur disque, `endOfLine: lf` côté prettier). La seule
  mesure probante est `nx format:check --base=origin/main --head=HEAD`.
- **`pnpm liens` est rouge en permanence sous Windows, et ce rouge-là ne veut
  rien dire.** (`EM-03`) Même cause : le script découpe sur `\n` seul, donc il n'extrait
  aucune ancre d'un fichier à fins de ligne CRLF et déclare mortes toutes celles
  qui le visent (31 erreurs mesurées le 2026-08-12 sur un arbre intact). **Mais la
  frontière est nette** : le hook de formatage post-édition réécrit en LF tout
  fichier qu'on touche, donc les fichiers du **diff en cours** sont exactement
  ceux que la porte sait juger. Lire sa sortie **fichier par fichier** — une
  erreur sur un fichier du diff est réelle, une erreur sur un fichier non touché
  est du bruit — et laisser la CI (checkout LF) juger l'ensemble. Ne pas en
  conclure que la porte est cassée : c'est ainsi qu'on cesse de la lire.
- **`git fetch` avant de brancher** (`EM-08`) : le préflight est hors-réseau par
  construction, il ne peut pas voir un `origin/main` périmé.
- **Le ratchet ESLint (`lint-warnings.mjs`) ne tourne pas sous Windows : c'est une
  porte de CI seulement.** (`EM-02`) Il lint le dépôt ENTIER dans un seul processus ; sur ce
  poste il épuise le tas et meurt en `FATAL ERROR: JavaScript heap out of memory`
  — mesuré trois fois, jusqu'à **8 Go de tas et 28 min** avant l'abandon, y compris
  avec `--max-old-space-size`. Le **même step passe en ~3 min sur le runner Linux**.
  Ne pas chercher à le faire aboutir en local, et surtout ne pas en conclure que la
  baseline est cassée. Mesure locale utile à la place : `nx run <projet>:lint` sur
  les projets touchés — s'ils n'introduisent aucun warning, le total ne peut pas
  monter.
- **Un `| tail` masque le code de sortie** (`EM-09`, c’est celui de `tail`) : une suite
  entière a déjà été lue « verte » alors que 7 cibles échouaient.
- **UI** (`EM-10`) : la suite axe ne voit ni le focus, ni les bordures de champ, ni
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
