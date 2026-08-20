---
name: chantier-calendriers-vacances
description: "Chantier « Calendriers d'ouverture & vacances scolaires » (SFD 31 v1.0, 5 lots) — lot 1 mergé (#352), lot 2 (schéma + API de lecture) livré le 2026-08-20 ; l'ancre de connaissance et l'axe du régime de fériés sont tranchés"
metadata:
  node_type: memory
  type: project
---

# Chantier « Calendriers d'ouverture & vacances scolaires » (SFD 31)

SFD `docs/31-sfd-calendriers-vacances-scolaires.md` **validée v1.0 le 2026-08-16**
(décision PO en son §0), plan `.claude/plans/calendriers-vacances-scolaires.md`
amendé le même jour : **4 → 5 lots**, la D6 est renversée — le calendrier **est**
versionné à date d'effet, un mois déjà facturé est intouchable.

Lancement autorisé par le PO le **2026-08-19**, « Le coût ne ment plus » étant
complet (lots 1-3 mergés le 17/08).

## État des lots

| Lot | Objet                                                  | État                                                               |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | Domaine calendrier versionné + fériés partagés         | **mergé 2026-08-19** (#352, `df77ebf`), non déployé                |
| 2   | Schéma versionné + API de lecture (contrat figé)       | **livré 2026-08-20**, branche `feat/calendrier-schema-api-lecture` |
| 3   | Import open data + écran calendrier                    | à faire (préalable : lot C0 de consolidation)                      |
| 4   | Branchement génération + reprise `jour_non_facturable` | à faire                                                            |
| 5   | Web : sélectionnabilité, visualisation, incohérences   | à faire (préalables : C0, et C5 tranché)                           |

## Ce que le lot 1 a décidé — et qui engage les quatre autres

**L'ancre de connaissance : candidat (a), l'instant de facturation du mois.** La
question était ouverte dans le plan (D6 révisée) avec deux candidats et aucune
réponse évidente. Retenu : `ancreDeConnaissance(maintenant, factureLe?)`, motif
écrit dans `calendrier-ouverture.ts`. La règle tient en une phrase : **un mois
facturé garde l'interprétation qu'il avait à sa facturation ; un mois non facturé
suit le calendrier d'aujourd'hui.** Le candidat (b) — `planning_mois.created_at` —
figerait un mois dès la saisie de son planning, soit des semaines avant sa
facturation : une correction de calendrier faite en septembre ne s'appliquerait
plus à un mois d'octobre saisi en août, l'inverse du besoin, et CA4 perdrait son
sens. **Conséquence pour le lot 4** : la facturation enregistre `factureLe` au
premier arrêté du mois et ne le rebouge plus ; tant que la colonne n'existe pas,
`factureLe` reste `undefined` et le comportement est celui d'aujourd'hui — donc
déployable sans reprise.

**La forme d'historisation, que le lot 2 doit traduire sans la réinventer** :
append-only par ligne (`clore` clôt, n'écrase pas), intervalle de connaissance
**semi-ouvert** `[connuDepuis, connuJusqua)`. ⚠️ La borne haute de l'axe de
connaissance est **exclusive**, alors que le `au` de l'axe métier est **inclusif** :
les aligner par confort décalerait la vérité d'un jour sans rien casser de
visible. Les unicités partielles attendues en base sont exactement les clés de
`verifierUniciteOuverte` : `UNIQUE (etablissement_id, jour) WHERE connu_jusqua IS
NULL` et `UNIQUE (etablissement_id, regime, jour_semaine) WHERE connu_jusqua IS
NULL`.

**`Instant` est brandé** (`libs/shared-kernel/src/lib/instant.ts`) : c'est la
seule garde qui empêche mécaniquement de repasser une date ISO nue là où on
attend un instant de connaissance — le piège nommé par le plan. Format imposé
`YYYY-MM-DDTHH:MM:SS.sssZ`, largeur fixe : c'est ce qui rend la comparaison
lexicographique équivalente à la comparaison chronologique (un offset `+02:00`
est refusé).

**`joursFeries(annee, regime)` vit dans le `shared-kernel`**, pas dans
`planification-domain` : le plan 32 le lira depuis `famille-domain`, et les
`depConstraints` Nx interdisent tout import inter-contextes hors `context:shared`.
Régimes `FR` / `FR_ALSACE_MOSELLE` (Mulhouse), type ouvert — le plan 32 y ajoutera
`CH_BL`.

**Deux périodes qui se chevauchent se départagent par la SPÉCIFICITÉ, pas par la
connaissance** (revue PR #352, `LE-84`) : l'import ne publie que les vacances,
l'année scolaire saisie d'un bloc les contient — la **plus courte** l'emporte
(ordre total : étendue, puis connaissance, puis `du`). Départager par l'instant
de connaissance rendrait la réponse dépendante de l'**ordre de saisie**, ce que
l'import du lot 3 heurterait de plein fouet.

## Ce que le lot 2 a décidé — et qui engage la suite

**`AM-106` est tranché, en faveur de l'axe de connaissance.** Le régime de fériés
n'est **pas** une colonne d'`etablissement` (la D2 le prévoyait ainsi) : il vit dans
une **quatrième table append-only**, `calendrier_regime_feries`, de forme identique
aux trois couches. Le motif est que c'était le **dernier** chemin de retouche
rétroactive du chantier — corriger un `FR` saisi par erreur en `FR_ALSACE_MOSELLE`
rouvrait le Vendredi saint et le 26 décembre sur des mois déjà facturés. La variante
« limite écrite et assumée » revenait à laisser survivre le seul chemin de réécriture
du passé au chantier qui existe pour le fermer. **Une source, pas deux** : il n'y a
pas de colonne de cache sur `etablissement` ; `EtablissementVue.regimeFeries` est
la valeur _actuellement connue_, lue sur la ligne ouverte, avec repli `FR` (D7).
⚠️ **Conséquence pour le CRUD établissement** : `EtablissementService` écrit dans la
transaction du calendrier (`poserRegimeFeries(tx, …)`), et `EtablissementModule`
importe donc `CalendrierModule`.

**Le contrat de lecture est gelé, et son défaut est observable.** `GET
…/calendrier?du=&au=&aLaDate=` rend `{ du, au, aLaDate, jours[] }` — l'enveloppe
**réverbère** l'instant de connaissance réellement employé, y compris (surtout) quand
l'appelant l'a omis. C'est ce qui rend le défaut « maintenant » constatable au lieu
de supposé, et ce qui laisse la place à un champ futur sans casser le consommateur
silencieux du plan 33.

**Deux écarts d'API assumés vs l'énoncé du plan** : deux routes de lecture de couche
en plus (`GET …/periodes`, `GET …/exceptions`) — sans elles, les `PUT`/`DELETE` par
identifiant demandés par le plan sont inutilisables, on ne supprime pas un `id`
qu'aucune route ne fait connaître ; et **pas de `PUT` sur les exceptions**, le `POST`
étant un **upsert par jour** (il clôt l'ouverte et en ouvre une neuve), ce qui _est_
la retouche voulue.

**« Supprimer » est une clôture, partout.** Aucune écriture du calendrier ne fait de
`DELETE` ni d'`UPDATE` de donnée. Une sonde de spec lit la **source** du service et
refuse tout `.delete(` — la différence entre « les cas testés ne suppriment pas » et
« le service ne sait pas supprimer », qui est la propriété que RM-31-03 exige.

## Pièges et écarts constatés au lot 2

- ⚠️ **Le calendrier EST exporté en portabilité, historique compris** (`LE-89`) : les
  quatre tables pendent à `etablissement` par une clé `ON DELETE CASCADE`, donc le
  critère du §6 de la doc 37 — « ce qu'un effacement emporte, un export doit le
  rendre » — s'applique. La ligne « hors périmètre : barèmes, grilles et
  **calendriers** » visait ceux du **référentiel** : même mot, propriétaire
  opposé. `ExportEtablissement.calendrier` rend les lignes **closes** aussi, avec
  leurs bornes — sans quoi l'export livrerait un calendrier sans passé.
- ⚠️ **Un faux `db` prouve la forme de l'appel, jamais que la requête s'exécute**
  (`LE-88`) : le prédicat de borne haute passait par un gabarit SQL interpolant
  une valeur — le `Date` partait en paramètre **sans le type de la colonne**, et
  `postgres` refusait de l'encoder. **500 sur les deux lectures du calendrier**,
  invisible au typecheck, au lint et aux 23 tests unitaires du service. Seule la
  **vérification pact provider** (vraie base, CI) l'a vu. Corrigé par les
  comparateurs typés de drizzle (`gt`), et une **sonde de source** interdit
  désormais tout gabarit SQL dans ce service.
- ⚠️ **`verifierUniciteOuverte` n'est appelée nulle part** (`AM-107`) : l'unicité
  ouverte n'est tenue que par les index partiels Postgres, donc une violation
  concurrente remonte en `23505` brut (500) au lieu du 409 que le CRUD
  établissement sait déjà produire.
- ⚠️ **Un faux `db` indexé par rang d'appel teste l'ordre d'évaluation** (`LE-85`) :
  les constructeurs drizzle sont des _thenables_, la requête n'est consommée qu'au
  `await`. Dans un `Promise.all`, l'ordre de consommation ne suit pas l'ordre
  d'écriture. Le faux répond désormais **par table**.
- ⚠️ **Le piège « `nx <svc>:typecheck` est lib-only » est PÉRIMÉ ici** (`LE-86`) :
  le `tsconfig.json` de `svc-planification` référence aussi `tsconfig.spec.json`,
  la commande signale bien les erreurs de specs. Le contournement annoncé par le
  plan était du travail en double.
- ⚠️ **L'oracle de routes avait encore dérivé** (`LE-87`, motif `MO-2`) : 38
  annoncé par le plan, **39** dans le code, porté à **45**.
- **La migration `0010` et ses index partiels ne sont prouvés qu'en CI** (`EM-16`
  encore actif : pas de Docker ici, donc pas de Postgres jetable). C'est la
  **vérification pact provider** qui les exerce, avec un état seedé portant une
  retouche de récurrence — sans cette retouche, une implémentation qui ignore
  `aLaDate` passerait au vert.

## Pièges et écarts constatés au lot 1

- ⚠️ **Le relevé du plan avait dérivé sur les migrations** : il annonçait `0009`
  comme prochaine, alors que `0009_purge_bornes_temporelles.sql` existe déjà —
  **le lot 2 écrit `0010`**. Corrigé dans le plan.
- ⚠️ **Le `no-useless-constructor` du ratchet est un faux positif évitable**
  (`AM-104`) : `@typescript-eslint` ne signale pas un constructeur dont
  l'accessibilité `public` est **écrite** dans une classe qui a une `superClass`.
  Les 5 classes d'erreur ajoutées par ce lot n'ajoutent donc **aucun** warning ;
  les 27 existantes attendent le même mot.
- ⚠️ **Le ratchet ne peut baisser que depuis la CI** (`EM-19`, extension d'`EM-02`) :
  ce lot supprime 3 warnings sans qu'aucune session locale puisse verrouiller le
  nouveau total dans `lint-baseline.json`.
- ⚠️ **Un jour hors de toute période est lu « scolaire »** (`AM-105`) : le régime
  par défaut est `SCOLAIRE`, nécessaire à la crèche qui n'en a qu'un. Un trou de
  calendrier (plage non importée) est donc indiscernable d'une vraie période
  scolaire — à signaler à l'écran du lot 3 ou dans les incohérences du lot 5.
- ⚠️ **Le régime de fériés échappe à l'axe de connaissance** (`AM-106`, à trancher
  au lot 2) : « les fériés sont calculés donc non historisés » est vrai du calcul,
  faux de son **entrée** — `regimeFeries` est une colonne simple. Corriger un `FR`
  en `FR_ALSACE_MOSELLE` rouvrirait le Vendredi saint sur des mois déjà facturés.
  C'est le seul chemin de retouche rétroactive qui survit au lot 1.
- ⚠️ **Deux fériés peuvent tomber le même jour** (`LE-83`) : Ascension = 8 mai en
  2059, 2070, 2081, 2092, 2127 (29 années sur 1583-2200). `joursFeries` déduplique
  et garde le libellé **fixe** ; le test balaye désormais toute la plage — le
  précédent scannait 2020-2040, la seule fenêtre sans collision.
- **La table de vérité ne trouve que ce qu'on y met** (`LE-82`, motif `MO-1`) :
  c'est le MBT qui a exhibé le calendrier où deux lignes ouvertes portaient le
  même instant de connaissance, et où la résolution dépendait alors de l'ordre du
  tableau.

Lié : [[plan-sfd-30-33-extension-famille]], [[chantier-versionnement-dates-effet]],
[[chantier-cout-ne-ment-plus]].
