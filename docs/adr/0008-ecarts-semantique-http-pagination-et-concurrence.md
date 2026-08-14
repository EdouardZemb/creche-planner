# ADR-0008 — Écarts assumés de sémantique HTTP : pagination et concurrence optimiste

- **Statut** : Accepté
- **Date** : 2026-08-14
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md)
  (exemption domestique assumée) — dont les **seuils de révision** servent ici de
  déclencheurs, plutôt que d'en inventer de nouveaux.
- **Déclencheur** : revue des standards industriels d'août 2026 (`AM-40`, `AM-41` de la
  [doc 34](../34-registre-ameliorations.md)), lot 7 du plan
  `.claude/plans/plan-standards-industriels.md`.

## Contexte

Le lot 7 rassemble trois manques de sémantique HTTP relevés en août. Le premier
(`AM-39`, `Location` sur les créations) est **outillé** : les créations qui exposent une
URI la nomment, et une garde tient l'accord entre le code et le contrat. Les deux autres
ont, dès leur écriture, un critère de sortie qui accepte un écart écrit — parce que leur
valeur dépend entièrement de l'échelle du produit, et que l'échelle est ici connue.

Cet ADR est cet écrit. Il existe pour que les deux absences soient **décidées** et
**datées d'une condition de réouverture**, au lieu de rester des cases vides qu'une revue
ultérieure relèverait une deuxième fois — c'est exactement ce qui est arrivé au RGPD avant
l'ADR-0007.

Les faits qui pèsent, tous vérifiés dans le code au 2026-08-14.

### Ce que le produit est aujourd'hui

Un outil familial **mono-foyer** ([ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md)) :
les écrivains simultanés possibles sont les **parents d'un même foyer**, sur leurs propres
appareils. Aucun établissement, aucun tiers, aucun client machine n'écrit dans le système.

### Pagination — l'état constaté

Le contrat public ne déclare **aucun** paramètre `limit`, `offset` ou `cursor` (les seules
occurrences du mot « limit » y désignent la _limitation de débit_). Mais « aucune borne
nulle part » serait inexact, et l'exception est instructive : la boîte de réception in-app
est **plafonnée côté service** à ses 50 entrées les plus récentes
([`inbox.service.ts`](../../apps/svc-notifications/src/inbox/inbox.service.ts)), avec un
compteur de non-lus qui, lui, n'est **pas** borné par ce plafond — la cloche dit donc la
vérité même au-delà de 50. C'est un plafond qui ne ment pas, et c'est la seule collection
qui en avait besoin.

Pour les autres, ce qui borne la collection n'est pas la même chose selon les cas, et c'est
le cœur de la décision :

| Collection                                                                              | Ce qui la borne aujourd'hui                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /foyers/{id}/parents`, `/enfants` (dossier), `/etablissements`, `/contrats?foyer=` | La **composition du foyer** — quelques lignes, structurellement                                                                                                                                                                                                                               |
| `GET /moi/notifications`                                                                | Rétention **T4** (12 mois) **et** le plafond de 50 ci-dessus                                                                                                                                                                                                                                  |
| `GET /foyers/{id}/versions`, `GET /contrats/{id}/versions`                              | Le **débit de saisie humaine** sur la vie du dossier. T1 et T2 sont ⛔ en [doc 37](../37-registre-des-traitements.md) §3 : rien ne les purge, ces deux collections croissent donc **indéfiniment**, mais d'une ligne par saisie de ressources ou par avenant — des dizaines, pas des milliers |
| `GET /notifications/a-valider`                                                          | Un filtre `statut = 'A_VALIDER'` : borne **comportementale**, pas structurelle — elle ne croît que si le parent ne valide jamais                                                                                                                                                              |
| `GET /referentiel/grilles`                                                              | Une publication par période tarifaire — quelques lignes par an                                                                                                                                                                                                                                |
| `GET /foyers`                                                                           | **Rien**. C'est la seule collection dont la taille ne dépend pas du foyer : elle vaut le **nombre de foyers de la base**                                                                                                                                                                      |

### Concurrence optimiste — ce que l'énoncé supposait, et ce qui est vrai

L'énoncé d'`AM-41` s'appuyait sur un fait : « `foyer_version` versionne déjà côté données ».
Il est exact, et il ne donne **pas** ce qu'un `ETag` demande. `foyer_version` est un
versionnement **temporel** — une ligne par _date d'effet_, clé unique
`(foyer_id, date_effet)` — et non un numéro de révision de l'entité courante. Deux saisies
simultanées à la même date d'effet ne produisent pas deux versions : elles **écrasent la
même ligne** (`onConflictDoUpdate`). Le versionnement métier ne fournit donc aucun
validateur, et il n'y a rien à « brancher ».

Ce qui existe vraiment est une colonne `updated_at` sur huit tables (quatre dans
`svc-foyer`, quatre dans `svc-planification`). Elle n'est exposée **nulle part** : ni dans
une vue de service, ni dans un schéma du contrat OpenAPI, ni dans un `z.object` de client
de la passerelle. La faire remonter jusqu'au client suppose donc de traverser les quatre
couches pour **chaque** ressource éditable — et le `z.object` du client strippe les clés
qu'il ne connaît pas, si bien qu'un oubli à cette étape-là est silencieux (`LE-48`).

Un obstacle plus profond que le coût : **la passerelle est un BFF, ses lectures sont des
vues composées.** `GET /foyers/{id}` rend `{ foyer, enfants, parents }` — trois appels —
alors que `PUT /foyers/{id}` ne touche que les scalaires du foyer. Un `ETag` est le
validateur de la **représentation** servie (RFC 9110 §8.8.3) : honnête, il couvre le
dossier entier, et un parent qui édite les revenus prendrait un 412 parce que l'autre vient
d'ajouter un enfant. Restreint à ce que le `PUT` touche, il cesse de décrire la
représentation à laquelle il est attaché — c'est-à-dire qu'il ment à tout cache. Les deux
formes sont défendables ailleurs ; aucune n'est bonne sur une façade orientée écran.

Enfin, « s'écrasent en silence » est **faux là où la perte coûterait le plus**. Une
réécriture des ressources du foyer à une date d'effet déjà servie journalise l'**avant et
l'après** dans `correction_journal`
([`foyer.service.ts`](../../apps/svc-foyer/src/foyer/foyer.service.ts)) et, depuis le lot 6,
l'**acteur** dans `journal_audit` : la valeur perdue est retrouvable et l'auteur connu. Le
silence est réel ailleurs — enfant, parent, établissement, contrat, version de contrat,
planning, préférences — où seule l'existence de deux écritures est tracée, jamais leur
contenu, et seulement dans `svc-foyer` (`AM-76`/`AM-77` couvrent le reste).

## Décision

### 1. Aucune pagination — `AM-40`

Les collections restent renvoyées entières. Une seule échappe à une borne : `GET /foyers`,
et sa taille **est** le nombre de foyers réels, c'est-à-dire un. Paginer aujourd'hui
ajouterait un protocole (paramètres, enveloppe de réponse, boucle côté web, contrat,
types générés) au service d'un cas qui n'existe pas, et le mauvais dimensionnement d'une
pagination écrite d'avance se paierait au moment où elle deviendrait utile.

Le plafond existant de la boîte de réception n'est **pas** rétrogradé : c'est le patron à
reprendre le jour où une autre collection en aurait besoin — borner l'affichage, et
publier à côté un compte qui ne l'est pas.

### 2. Aucune concurrence optimiste HTTP — `AM-41`

Pas d'`ETag`, pas d'`If-Match`, pas de 412. Les mutations concurrentes restent en
« dernier écrivain gagne ».

Ce n'est pas « rien » : ce qui tient lieu de filet est la **traçabilité**, et elle est
inégale — complète sur les ressources du foyer (`correction_journal` porte l'avant/après),
partielle ailleurs (`journal_audit` dit qui a écrit, pas ce qui a été perdu), absente hors
de `svc-foyer` jusqu'à `AM-76`/`AM-77`. C'est un filet **a posteriori**, adapté à deux
parents qui se parlent, pas à des écrivains qui ne se connaissent pas.

Le jour où la décision s'inverse, elle ne commencera pas par l'`ETag` : elle commencera
par **exposer un validateur** (`updated_at` ou une révision dédiée) jusqu'au client, et par
décider si la ressource éditable reste la vue composée ou devient une ressource propre. La
seconde question est la vraie, et la poser d'avance est le seul travail que cet ADR fait
en avance.

## Risque résiduel — assumé

- **Pagination** : une lecture peut ramener un tableau plus gros que prévu si un dossier
  vit très longtemps (`/foyers/{id}/versions`, `/contrats/{id}/versions`, que rien ne
  purge). Le risque est une page lente, jamais une donnée fausse.
- **Concurrence** : deux parents qui éditent le même enfant, le même contrat ou le même
  planning au même moment perdent l'une des deux saisies, **sans que l'écran le dise**. La
  probabilité tient à la taille de la population d'écrivains — deux personnes d'un même
  foyer — et non à une garde technique. C'est le risque que cet ADR assume nommément.

## Conséquences

**Ce que la décision rend vrai :**

- `AM-40` et `AM-41` sont **soldées par un écart écrit**, conformément à leurs critères de
  sortie ; elles ne reviendront pas comme constats neufs à la prochaine revue ;
- le plan `.claude/plans/plan-standards-industriels.md` peut clore son lot 7 : `AM-39`
  outillée, les deux autres décidées.

**Ce qu'elle ne change pas :**

- `AM-76` et `AM-77` (extension de la piste d'audit à `svc-planification` et
  `svc-notifications`) gardent toute leur valeur, et en gagnent même : elles sont le filet
  cité ci-dessus, et cet ADR les désigne comme tel ;
- aucune garde de CI n'est ajoutée. Deux absences décidées ne se gardent pas : ce qui les
  surveille, ce sont les seuils de révision ci-dessous — les mêmes que l'ADR-0007, donc
  déjà relus à chaque revue.

## Révision

Cet ADR **doit être rouvert** si l'un de ces seuils est franchi. Les deux premiers sont,
mot pour mot, ceux de l'[ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md) — ce
n'est pas une coïncidence : ce qui fait tomber l'exemption domestique est aussi ce qui fait
apparaître des collections longues et des écrivains qui ne se parlent pas.

- **L'application sert plus d'un foyer réel**, ou est proposée à des foyers tiers ⇒ la
  pagination de `GET /foyers` se décide **avec** cette bascule, pas après (`AM-40`).
- **Un établissement obtient un accès direct** (compte, portail, dépôt) ⇒ les écrivains
  cessent d'être deux personnes d'un même foyer, et la concurrence optimiste se décide
  **avec** cet accès (`AM-41`).
- **Un client machine ou une automatisation** écrit sur une route de mutation (import,
  synchronisation, API publiée) — même sans établissement ⇒ `AM-41`.
- Une collection réelle **dépasse quelques centaines de lignes** — les deux candidates
  connues sont `/foyers/{id}/versions` et `/contrats/{id}/versions`, que rien ne purge
  (T1 et T2 sont ⛔ en doc 37 §3) ⇒ `AM-40`, et le patron à reprendre est celui de la
  boîte de réception, pas une pagination générale.
