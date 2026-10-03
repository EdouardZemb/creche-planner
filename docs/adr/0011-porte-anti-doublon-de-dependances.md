# ADR-0011 — Porte anti-doublon de dépendances : une liste d'identités uniques, pas « zéro doublon »

- **Statut** : Accepté
- **Date** : 2026-10-03
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0003](0003-decisions-de-toolchain.md) (monorepo Nx + pnpm,
  et ce que le gestionnaire de paquets impose au reste).
- **Déclencheur** : le 2026-10-02, un lockfile régénéré a introduit un second
  `@nestjs/common` ; la passerelle a cessé de compiler sans qu'une ligne de code change
  (PR #408, une heure de recherche).

## Contexte

pnpm installe sans broncher plusieurs versions d'un même paquet. C'est le plus souvent
inoffensif — trois `@esbuild/*`, cinq `minimatch`, quatre `react-is` — et c'est parfois
fatal : quand le paquet porte une **identité** que le code teste à l'exécution ou à la
compilation.

Deux copies de `@nestjs/common`, ce sont deux `class Injectable` distinctes, donc deux
jeux de jetons d'injection, donc un provider qu'on ne retrouve plus ; deux copies de
`react`, un répartiteur de hooks dédoublé ; deux copies de `zod`, un `instanceof
ZodError` qui rend `false` à la frontière HTTP. Le diff ne montre rien : seul le
lockfile a bougé.

C'est exactement le mode de défaillance que ce dépôt combat ailleurs — **une
affirmation vraie quand elle a été écrite, fausse quand elle a été lue**. Ici,
l'affirmation (« il n'y a qu'un `@nestjs/common` ») n'était écrite nulle part, donc
personne ne la relisait.

## Décision

Une porte bloquante, `pnpm doublons` ([`scripts/verifier-doublons.mjs`](../../scripts/verifier-doublons.mjs)),
qui lit `pnpm-lock.yaml` et **refuse qu'un paquet nommé à identité unique se résolve en
plusieurs versions**.

Trois choix la définissent.

### 1. Une liste nommée, pas « zéro doublon »

Mesure sur `main` à `5e9b8b9`, avant d'écrire une ligne de porte : **193 paquets**
portent plusieurs versions, pour **263 instances excédentaires**. Une porte qui
échouerait sur tout doublon serait rouge dès son premier run et le resterait ; elle
serait désactivée en deux semaines. **C'est le vrai risque ici, pas le faux négatif** :
une porte bruyante ne protège de rien, et son retrait emporte aussi les cas qu'elle
attrapait.

La porte ne juge donc que **13 paquets**, chacun inscrit avec la phrase qui dit ce que
sa duplication casse : les cinq `@nestjs/*` de l'arbre, `reflect-metadata`, `rxjs`,
`react`, `react-dom`, `zod`, `drizzle-orm`, `@opentelemetry/api`, `typescript`.

### 2. Pas de cliquet global

Un cliquet sur le nombre total de doublons (à la manière du ratchet ESLint) a été
envisagé et écarté : ce nombre bouge à chaque montée Dependabot, pour des raisons sans
rapport avec un risque. La porte rougirait sur des PR saines et le remède habituel
serait de relever le plafond — un rituel qui vide la porte de son sens.

### 3. Pas `pnpm dedupe --check`

C'était le candidat naturel. Écarté pour deux raisons, la seconde dirimante :

- **Il répond à une autre question.** `dedupe --check` demande « les plages déclarées
  permettraient-elles de resserrer le lockfile ? », pas « ce paquet-ci a-t-il deux
  identités ? ». Deux versions imposées par des plages incompatibles — exactement le cas
  de #408 — le laissent muet, tandis qu'il signale des resserrements possibles qui ne
  cassent rien.
- **Il résout contre le registre npm.** Son verdict dépend de ce que le registre contient
  à l'instant du run : le même commit peut passer le matin et échouer l'après-midi.
  Ce serait **fabriquer un exemplaire de plus du défaut qu'on cherche à tuer** — la même
  forme que la base Trivy qui a avancé entre 15h00 et 17h28 le 2026-10-03.

La porte retenue lit un fichier versionné, sans réseau, en moins d'une seconde, et rend
le même verdict pour le même commit, aujourd'hui et dans six mois.

### 4. Les tolérances portent une date

Deux doublons existent aujourd'hui parmi les paquets listés : `rxjs` (7.8.1 / 7.8.2) et
`typescript` (5.9.3 / 6.0.3). Les taire serait rouvrir le trou ; faire rougir la porte
dès sa naissance serait la condamner. Ils sont donc **tolérés nommément, avec une date
d'expiration obligatoire** : la porte échoue quand la date est passée, manquante ou
illisible, et avertit à J-14. Une tolérance devenue sans objet est signalée comme
inutilisée.

Les deux dates (`2026-11-30` pour `rxjs`, `2026-12-31` pour `typescript`) ont été
**posées par la PR qui crée la porte**, faute de date préexistante : elles valent
proposition, et se redatent avec une raison.

## Conséquences

**Acceptées.**

- La liste est **écrite à la main** : un paquet sensible qu'on oublie d'y mettre n'est
  pas gardé. C'est le prix du silence, et il est réel — la porte n'a pas d'oracle qui
  découvrirait les identités sensibles toute seule.
- La porte lit le lockfile, pas `node_modules` : une résolution locale abîmée lui est
  invisible.
- Elle ignore les suffixes de pairs de `snapshots:` ; seules les clés canoniques de
  `packages:` comptent.

**Obtenues.**

- Le défaut de #408 serait tombé à la première PR, avec son nom.
- Chaque entrée de la liste documente ce qui casse : la porte explique autant qu'elle
  interdit.
- Cinq sondes négatives (`pnpm doublons --autotest`) prouvent qu'elle mord encore :
  seconde version injectée, section `packages:` disparue, lockfile illisible, tolérance
  périmée, tolérance qui ne couvre plus le doublon observé.

## Alternatives écartées

| Option                                | Pourquoi non                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Échouer sur **tout** doublon          | 193 paquets concernés aujourd'hui : porte rouge en permanence, donc porte retirée                          |
| Cliquet sur le nombre total           | bouge à chaque montée de dépendance ; le réflexe deviendrait « relever le plafond »                         |
| `pnpm dedupe --check`                 | autre question, et verdict dépendant du registre à l'instant du run — non reproductible pour un même commit |
| `pnpm why` en post-contrôle manuel    | humain, donc oublié ; et ne laisse aucune trace dans la CI                                                  |
