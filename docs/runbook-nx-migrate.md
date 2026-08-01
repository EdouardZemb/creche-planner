# Runbook — migration Nx (`nx migrate`)

> Statut : **actif** · Créé le 2026-08-01 (lot B6 du chantier _Consolidation UI & qualité_)
> Public : contributeurs. Complète [CONTRIBUTING.md](../CONTRIBUTING.md) et la
> [doc 03](03-standards-developpement.md).

## Pourquoi ce runbook

Nx n'est pas une dépendance ordinaire : **une dizaine de paquets `@nx/*` doivent rester sur
la même version**, et un changement de majeure s'accompagne de _migrations de code_ (fichiers
de configuration réécrits par Nx lui-même). Un bump paquet-par-paquet ne fait rien de tout
cela.

C'est exactement ce qui s'est produit avant le passage 22.7.5 → 23.0.1 (`f5df517`, #148) :
cinq PR Dependabot individuelles (#92, #93, #95, #96, #97) ont été **fermées sans être
mergées** parce qu'elles se contentaient de changer un numéro de version. Le monorepo s'est
retrouvé avec `@nx/js`, `@nx/nest` et `@nx/node` en 23 et le reste en 22, cassant `ci`,
`pact-drift` et `openapi-types-drift`. Le rattrapage a coûté un chantier entier.

**Règle** : toute PR Dependabot qui touche `nx` ou un `@nx/*` se ferme, et la montée se fait
par le présent runbook, en une PR unique.

## Procédure

Toutes les commandes se lancent depuis la racine du dépôt, avec le pnpm imposé par le projet
(`corepack pnpm@10.34.2` — voir [CONTRIBUTING.md](../CONTRIBUTING.md)).

### 1. Brancher et préparer

```bash
git switch -c chore/nx-migrate-<version-cible>
```

Partir d'un arbre **propre** (`git status` vide) : `nx migrate --run-migrations` réécrit des
fichiers de configuration, et il faut pouvoir lire son diff sans bruit.

### 2. Écrire le plan de migration

```bash
corepack pnpm@10.34.2 exec nx migrate <version-cible>
```

Cette commande **n'installe rien** : elle met à jour `package.json` et écrit un fichier
`migrations.json` à la racine. Lire les deux avant d'aller plus loin :

- `package.json` — vérifier que **tous** les `@nx/*` passent à la même version, et repérer les
  peer-dependencies qui bougent en même temps (`webpack-cli`, `vite`, `vitest`, `typescript`,
  `eslint`…). C'est là que se cachent les vraies ruptures.
- `migrations.json` — la liste des migrations de code qui vont s'exécuter (12 pour le passage
  22 → 23).

### 3. Installer, puis appliquer les migrations

```bash
corepack pnpm@10.34.2 install
corepack pnpm@10.34.2 exec nx migrate --run-migrations
```

Puis relire le diff produit par Nx (`git diff`) **avant** de tester : les migrations touchent
`nx.json`, les `project.json`/`package.json` de projet et parfois les configs de test.
Exemples réellement rencontrés en 22 → 23 :

- `nx.json` : `releaseTagPattern` (chaîne) → `releaseTag.pattern` (objet) ;
- `nx.json` : la cible `test` est passée du plugin `@nx/vite` au plugin `@nx/vitest` ;
- `vitest.workspace.ts` → `vitest.config.ts` avec `test.projects` (API Vitest 4).

### 4. Nettoyer les artefacts

```bash
corepack pnpm@10.34.2 exec nx reset
rm -f migrations.json
```

`nx reset` vide le cache et le daemon : sans lui, le graphe de projets peut rester sur
l'ancienne interprétation des plugins et donner des résultats incohérents. `migrations.json`
ne se versionne pas (`.nx/migrate-runs` est déjà dans `.gitignore`, ligne 86).

### 5. Valider

```bash
corepack pnpm@10.34.2 nx run-many -t lint typecheck test build --all
```

Hors CI, les vérifications Pact côté provider se **skippent** faute de Postgres : c'est
normal, la CI les jouera. Vérifier aussi les deux gardes anti-dérive, qui sont les premières
à tomber quand la chaîne d'outils bouge :

```bash
corepack pnpm@10.34.2 nx run web:generate-types   # doit laisser openapi-types.gen.ts inchangé
corepack pnpm@10.34.2 nx format:check --base=origin/main --head=HEAD
```

### 6. Commiter

Un seul commit `chore(deps): migrate Nx monorepo <ancienne> -> <nouvelle>`, dont le corps
**liste les changements de configuration** appliqués par Nx et **justifie chaque version
maintenue en arrière** (cf. § suivant). Ce corps est la seule trace exploitable six mois plus
tard.

## Pièges connus

### Les peer-dependencies proposées par la migration ne sont pas toujours prenables

`nx migrate 23.0.1` proposait `webpack-cli` 7.x. Or le plugin `@nx/webpack` 23 générait encore
la commande `webpack-cli build --node-env`, option **renommée `--config-node-env`** en
webpack-cli 6/7 : le build des six services échouait sur
`Unknown option '--node-env=production'`. La migration a donc été mergée avec `webpack-cli`
maintenu en `^5.1.4` (dans la plage peer `^5 || ^6 || ^7`), puis le passage à `^7.1.0` a fait
l'objet d'une PR distincte (#151) une fois la commande adaptée.

**Leçon** : quand une peer-dependency casse le build, on la **fige et on documente pourquoi**,
puis on la traite dans sa propre PR. On ne mélange pas les deux.

### Les six services buildent via `nx:run-commands`, pas via l'exécuteur Nx

`apps/svc-*/package.json` et `apps/api-gateway/package.json` déclarent
`"command": "webpack-cli build"`. Une migration qui adapte l'exécuteur `@nx/webpack` **ne les
touchera pas** : leur ligne de commande est à vérifier à la main.

### Les cibles écrites à la main échappent aux `targetDefaults`

`nx.json` porte des `targetDefaults` (`typecheck → ^build`, `test → typecheck`), mais ils ne
s'appliquent **qu'aux cibles inférées par les plugins**. Les cibles déclarées explicitement
dans un `package.json` de projet — `web` (`typecheck`, `test`), `api-gateway` et les cinq
`svc-*` (`test`) — portent leur propre `dependsOn`. Après une migration qui change la façon
dont les cibles sont inférées, revérifier le graphe :

```bash
corepack pnpm@10.34.2 nx test web --graph=/tmp/g.json
```

Il doit contenir `contracts-kernel:build`, `shared-semaine:build`, `web:typecheck`, `web:test`.

### Le daemon Nx sert un graphe périmé

Après toute modification de `nx.json` ou d'un `package.json` de projet, un
`corepack pnpm@10.34.2 exec nx reset` avant de conclure quoi que ce soit sur le graphe de
tâches. Sans cela, on mesure l'ancien graphe et on croit que le changement n'a pas pris.

## Cadence

Voir l'hypothèse **H3** du plan `consolidation-ui-et-qualite` : la cadence de release (train
mensuel minimum vs rebuild `OS_PATCH` déclenchable) borne aussi le délai d'activation des lots
mergés-non-déployés. Une montée Nx se planifie **hors chantier fonctionnel**, jamais au milieu
d'un lot en cours : elle touche tout le monorepo et rend tout rebase pénible.
