---
name: chantier-calendriers-vacances
description: "Chantier « Calendriers d'ouverture & vacances scolaires » (SFD 31 v1.0, 5 lots) — lot 1 MERGÉ le 2026-08-20 (#352, df77ebf), NON DÉPLOYÉ ; l'ancre de connaissance est tranchée ; lot 2 à démarrer"
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

> **État au 2026-08-20** : lot 1 **MERGÉ** — PR #352, squash `df77ebf`, CI verte
> de bout en bout (24 checks). **NON DÉPLOYÉ** : le domaine ne sort en prod
> qu'avec le prochain train (celui qui portera aussi « Le coût ne ment plus »
> lots 1-3, le lot 9 des standards, #345 et #351). Aucun effet observable en
> production avant : ce lot n'a **aucun appelant runtime**.
>
> Au passage, le ratchet ESLint est verrouillé à **645** (était 649) et
> `@typescript-eslint/no-unused-vars` est promue en **`error`**.

## État des lots

| Lot | Objet                                                  | État                                                              |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | Domaine calendrier versionné + fériés partagés         | **livré 2026-08-19**, branche `feat/calendrier-domaine-versionne` |
| 2   | Schéma versionné + API de lecture (contrat figé)       | à faire                                                           |
| 3   | Import open data + écran calendrier                    | à faire (préalable : lot C0 de consolidation)                     |
| 4   | Branchement génération + reprise `jour_non_facturable` | à faire                                                           |
| 5   | Web : sélectionnabilité, visualisation, incohérences   | à faire (préalables : C0, et C5 tranché)                          |

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
