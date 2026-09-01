# 42 — SFD Vacances & ALSH : inscrire par période, pas jour après jour

> Statut : **BROUILLON — NE PAS DÉMARRER · en attente de validation PO** · Version 0.1 · 2026-09-01
> Troisième des cinq spécifications du domaine associatif ABCM (40 → 44). **Se branche sur deux
> choses qui existent** : le calendrier d'ouverture versionné
> ([SFD 31](31-sfd-calendriers-vacances-scolaires.md)) pour savoir quand l'ALSH remplace l'école,
> et le barème ABCM de la [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) §3.2 pour le tarifer.
> Consigne `AM-119` ([doc 34](34-registre-ameliorations.md)).

## 0. Ce que ça demande au PO

Trois décisions, et une bonne nouvelle.

**La bonne nouvelle d'abord** : l'ALSH est **déjà tarifé et déjà généré**. Journée complète,
demi-journée, repas, mercredis récurrents, jours de vacances saisis par date, exclusion des jours
fermés — tout cela existe et fonctionne (`libs/planification/domain/src/lib/inscription-abcm.ts`,
`libs/tarification/domain/src/lib/abcm/tarif-alsh-abcm.ts`). Cette SFD ne refait rien de cela.

1. **Le grain de l'inscription : six créneaux, ou deux ?** Le règlement propose
   **matin · matin-midi · midi · midi-soir · soir · journée complète**. Le produit ne connaît que
   `journée complète` et `demi-journée`, sans dire **quelle** demi-journée, et ne sait pas
   représenter « midi seul ». Deux issues : enrichir le grain de saisie (six créneaux, tarifés
   comme aujourd'hui : journée ou demi + repas), ou assumer les deux formules actuelles et
   accepter que Martha ne reflète pas fidèlement ce qui est réservé sur le portail.
   **Recommandation : enrichir la saisie, ne pas toucher au tarif** — c'est un problème de miroir,
   pas de calcul.
2. **Que fait Martha d'une période de vacances ?** Aujourd'hui, inscrire une semaine de Toussaint
   revient à saisir cinq dates une par une. La valeur de cette SFD tient en une phrase :
   **inscrire une période en un geste**, avec ses exceptions. C'est la seule vraie
   fonctionnalité nouvelle du document.
3. **Quelle échéance pour les vacances ?** Le règlement écrit une seule échéance générale — le
   **jeudi 12 h pour la semaine suivante**. Une inscription de vacances passe très probablement
   par une campagne ouverte plus tôt, avec une date limite propre. Aucune source ne le dit
   (`Q-42-01`). **Recommandation : modéliser l'échéance comme une donnée de la période**, avec
   pour valeur par défaut la règle générale — sans inventer une date.

### Ce que cette spécification ne décide pas

**L'ordonnancement.** Elle ne peut pas précéder la [SFD 43](43-sfd-calendrier-scolaire-abcm.md)
(qui pose les dates réelles) ni les lots de calendrier de la
[SFD 31](31-sfd-calendriers-vacances-scolaires.md) : sans eux, « période de vacances » n'est pas
une donnée du système.

## 1. Contexte & problème

L'accueil de loisirs fonctionne **les mercredis et pendant les vacances scolaires**, de **7 h 30 à
18 h 00**, de la petite section au CM2. Il se fréquente à la **journée ou à la demi-journée**,
**avec ou sans repas**, et c'est le seul service ouvert **à tous**, membres ou non — les autres
supposent une famille à jour de cotisation.

Les vacances où l'ALSH ouvre ne sont pas toutes les vacances, et ce sont des dates précises
([SFD 43](43-sfd-calendrier-scolaire-abcm.md)) : Toussaint, hiver, printemps, et deux fenêtres
d'été. Entre les deux fenêtres d'été, il n'y a **rien** — un trou de garde de plusieurs semaines
que la famille doit voir venir bien avant juillet.

Le problème n'est donc ni le tarif ni le calcul : c'est **la saisie et l'anticipation**.

### 1.1 Constat négatif — relevé sur `main` (`80e2875`), le 2026-09-01

| Point                                        | État réel                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarification ALSH (journée, demi, repas)     | **Existe**, par tranche, versionnée. Rien à écrire.                                                                                                                                |
| Génération des quantités du mois             | **Existe** : dates explicites prioritaires sur la récurrence hebdomadaire, exclusion des jours non facturables, pas de double comptage.                                            |
| Mercredis récurrents                         | **Existent** (inscription ALSH hebdomadaire de la semaine type).                                                                                                                   |
| Les six créneaux du règlement                | **N'existent pas** : le modèle ne connaît que `COMPLETE` et `DEMI`, sans préciser la demi-journée, et ne peut pas exprimer « midi seul ». → `AM-119`.                              |
| L'inscription **par période**                | **N'existe pas** : une semaine de vacances se saisit date par date.                                                                                                                |
| L'échéance d'inscription des vacances        | **N'existe pas** — ni comme donnée, ni comme rappel. Voir [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) pour la mécanique d'échéance dont celle-ci hériterait.                |
| L'alerte « vacances sans solution de garde » | **Spécifiée ailleurs, non livrée** : `US-31-05` a été **reportée** au plan 33 (conflit `CF-03`) par la décision PO du 2026-08-16. Cette SFD ne la reprend pas — elle la référence. |

## 2. Périmètre

### Dans le périmètre (v1)

- **Inscrire une période d'un geste** : « Toussaint, du 19 au 23 octobre, journée complète avec
  repas, sauf le mercredi » — une saisie, des jours générés, des exceptions possibles.
- **Enrichir le grain de saisie** aux six créneaux du règlement, sans toucher au barème.
- **Porter l'échéance d'inscription de la période** comme une donnée, avec rappel via le
  dispositif de la [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md).
- **Montrer le coût de la période** avant de valider, avec sa tranche et son détail.

### Hors du périmètre (v1) — et pourquoi

| Écarté                                        | Raison                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Réserver sur le portail                       | Frontière commune aux cinq SFD ([SFD 40](40-sfd-unites-associatives.md) §2).                                                                                  |
| Le barème ALSH                                | Déjà là, et dimensionné par la [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) lot 1. Rien à refaire.                                                      |
| Les dates 2026/27                             | Ce sont des **données** — [SFD 43](43-sfd-calendrier-scolaire-abcm.md).                                                                                       |
| L'alerte « vacances sans solution »           | Déjà arbitrée : reportée au plan 33. La redéfinir ici produirait un doublon et un second courriel.                                                            |
| Les sorties, thèmes et programmes d'activités | Martha n'est pas le journal de l'ALSH. Une période a des dates, un créneau et un coût.                                                                        |
| Le cas des non-membres                        | L'ALSH est ouvert à tous, mais Martha est l'outil **de ce foyer**, qui est membre. Modéliser l'adhésion comme condition d'accès serait du produit associatif. |

## 3. Abstractions & modèle

```
PeriodeAlsh                                  ← nouveau : l'unité de saisie
   ├─ libellé (« Vacances de Toussaint »)    ← dérivé du calendrier, pas ressaisi
   ├─ du / au                                 ← lus dans le calendrier d'ouverture (SFD 31)
   ├─ echeanceInscription?                    ← donnée ; défaut = règle générale du jeudi 12 h
   └─< InscriptionJourAlsh (générée, puis retouchable)
          ├─ date
          ├─ creneau : MATIN | MATIN_MIDI | MIDI | MIDI_SOIR | SOIR | JOURNEE   ← nouveau (AM-119)
          ├─ repas : booléen
          └─ formuleTarifaire : JOURNEE | DEMI       ← dérivée du créneau, jamais saisie
```

Deux points de conception qui décident du reste :

1. **Le créneau est ce que la famille réserve ; la formule tarifaire est ce que l'association
   facture.** Les deux ne coïncident pas — cinq créneaux sur six tombent en « demi-journée ».
   Dériver l'un de l'autre (et jamais l'inverse) évite d'inventer des tarifs que la grille n'a pas.
2. **Une période n'est pas une entité de calendrier.** Le calendrier d'ouverture
   ([SFD 31](31-sfd-calendriers-vacances-scolaires.md)) sait déjà ce qu'est une période de
   vacances et quels services y sont ouverts. `PeriodeAlsh` est une **inscription**, elle emprunte
   ses bornes au calendrier et ne les redéclare pas. Les redéclarer créerait deux calendriers.

### 3.1 Le tableau de correspondance créneau → formule

| Créneau réservé | Formule facturée | Repas possible |
| --------------- | ---------------- | -------------- |
| Matin           | Demi-journée     | non            |
| Matin-midi      | Demi-journée     | oui            |
| Midi            | Demi-journée     | oui            |
| Midi-soir       | Demi-journée     | oui            |
| Soir            | Demi-journée     | non            |
| Journée         | Journée complète | oui            |

> ⚠️ **Ce tableau est une hypothèse de lecture**, pas une règle sourcée : les tarifs publiés ne
> distinguent que « journée », « demi-journée » et « repas ». Il tient tant qu'aucune facture ne le
> contredit — et c'est exactement ce que le rapprochement de la
> [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) sert à découvrir (`Q-42-02`).

## 4. Acteurs

| Acteur      | Rôle                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| **Parent**  | Inscrit une période, retouche des jours, consulte le coût, marque la période transmise au portail.              |
| **Système** | Lit les périodes ouvertes dans le calendrier, génère les jours, dérive la formule tarifaire, calcule, rappelle. |

## 5. User stories

### US-42-01 — Inscrire une période en un geste

En tant que parent, j'inscris ma fille aux vacances de Toussaint en une saisie.

- **CA1** : la période et ses bornes sont **proposées par le calendrier**, jamais retapées.
- **CA2** : je choisis un créneau et le repas pour toute la période, puis je retouche des jours.
- **CA3** : les jours fermés de la période (férié, fermeture propre) ne sont pas générés, et
  l'écran dit pourquoi.
- **CA4** : le coût total de la période s'affiche **avant** de valider, avec sa tranche.

### US-42-02 — Retoucher un jour d'une période inscrite

En tant que parent, je retire le mercredi et je passe le vendredi en demi-journée.

- **CA1** : une retouche ne casse pas la période : elle porte sur un jour et se voit comme telle.
- **CA2** : le coût se recalcule immédiatement.
- **CA3** : les mercredis déjà couverts par la récurrence hebdomadaire **ne sont pas comptés deux
  fois** — la règle existante (dates explicites prioritaires) est conservée telle quelle.

### US-42-03 — Réserver le bon créneau, pas une approximation

En tant que parent qui n'a inscrit que le midi, je le saisis tel quel.

- **CA1** : les six créneaux du règlement sont proposés.
- **CA2** : la formule facturée (journée ou demi) est **affichée**, et l'écran dit qu'elle est
  déduite du créneau.
- **CA3** : une inscription existante en `COMPLETE` ou `DEMI` reste lisible après la reprise, sans
  choisir un créneau à sa place (`RM-42-04`).

### US-42-04 — Ne pas rater l'ouverture des inscriptions

En tant que parent, je suis prévenu qu'une période approche et n'est pas inscrite.

- **CA1** : le rappel passe par le **récapitulatif hebdomadaire existant**, comme toutes les
  échéances de ce domaine — aucun canal nouveau.
- **CA2** : le rappel cesse dès que la période est marquée transmise.
- **CA3** : une période sans échéance connue rappelle sur la **règle générale** (jeudi 12 h de la
  semaine précédente), en le disant.

### US-42-05 — Voir le trou de l'été

En tant que parent, je vois que l'ALSH ferme du 17 juillet au 22 août.

- **CA1** : les fenêtres d'ouverture d'été sont distinguées de la fermeture qui les sépare.
- **CA2** : cette vue est **informative** : l'alerte « vacances sans solution de garde » reste
  celle du plan 33 (`US-31-05` reportée), et n'est pas dupliquée ici.

## 6. Règles métier

- **RM-42-01 — Le calendrier fait foi pour les bornes.** Une période d'inscription emprunte ses
  dates au calendrier d'ouverture ; elle ne les saisit pas.
- **RM-42-02 — Le créneau est saisi, la formule tarifaire est dérivée.** Jamais l'inverse, et
  jamais un tarif qui ne serait pas dans la grille.
- **RM-42-03 — Une date explicite prime sur la récurrence hebdomadaire**, sans double comptage.
  Règle existante, conservée.
- **RM-42-04 — La reprise ne devine pas.** Une inscription existante en « demi-journée » reste une
  demi-journée : Martha ne lui invente pas un créneau (matin ou soir) que personne n'a saisi.
- **RM-42-05 — Réservé ⇒ facturé**, y compris en vacances, avec les mêmes exceptions et la même
  carence que la [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) `RM-41-02`.
- **RM-42-06 — Un jour fermé n'est jamais généré**, et son motif est affiché.
- **RM-42-07 — Aucun canal de notification nouveau** — même règle que
  [SFD 40](40-sfd-unites-associatives.md) `RM-40-07`.

## 7. Cadre de sécurité & données personnelles

- **Aucun tiers, aucun flux sortant.** Rien ne quitte l'application.
- **Aucune catégorie de données nouvelle** : dates, créneaux, repas. Le registre des traitements
  gagne des lignes de table, pas un traitement.
- **Le niveau scolaire** introduit par la [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) suffit
  à couvrir la borne d'âge (PS → CM2) ; cette SFD n'ajoute **aucune donnée sur l'enfant**.

## 8. Découpage en lots

| Lot   | Contenu                                                                                               | Ce qui le clôt                                                                |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **0** | Trancher `Q-42-01` et `Q-42-02`. Zéro code.                                                           | Les deux questions sont closes ou reportées par écrit.                        |
| **1** | Grain de créneau : six valeurs, formule dérivée, reprise sans devinette.                              | Une inscription « midi seul » existe et se facture en demi-journée.           |
| **2** | Inscription par période : génération depuis le calendrier, retouches par jour, coût avant validation. | Une semaine de vacances s'inscrit en un geste et se retouche sans se casser.  |
| **3** | Échéance de période et rappel dans le récapitulatif existant.                                         | Une sonde négative prouve qu'aucun second courriel n'est émis.                |
| **4** | Vue des fenêtres d'été et de leur intervalle.                                                         | Le trou entre les deux fenêtres est visible sans compter les jours à la main. |

> **Aucun lot ne démarre avant** que le calendrier d'ouverture soit persistant et interrogeable
> (SFD 31, lot 2 et suivants) : sans lui, `RM-42-01` n'a pas d'objet.

## 9. Questions ouvertes

- **Q-42-01** — Les inscriptions de vacances suivent-elles la règle générale du **jeudi 12 h**, ou
  une **campagne** avec sa propre date limite ? Aucune source consultée ne le dit. Défaut retenu :
  la règle générale, portée par une donnée modifiable.
- **Q-42-02** — La correspondance créneau → formule du §3.1 est-elle juste ? Notamment : « midi
  seul » est-il facturé en demi-journée + repas, ou au tarif repas seul ? À vérifier sur une
  facture réelle.
- **Q-42-03** — L'ALSH du mercredi et celui des vacances relèvent-ils du **même tarif** et de la
  **même échéance** ? Le produit les traite déjà pareil ; le règlement ne les distingue pas non
  plus. À confirmer, sans quoi c'est une hypothèse silencieuse de plus.

## 10. Ce que cette spécification engage

- **Un enrichissement de saisie sans changement de barème** — le tarif reste celui de la grille.
- **Une reprise de données prudente** : les inscriptions existantes gardent leur formule et ne
  reçoivent pas de créneau inventé (`RM-42-04`).
- **Une dépendance dure au calendrier** ([SFD 31](31-sfd-calendriers-vacances-scolaires.md) et
  [SFD 43](43-sfd-calendrier-scolaire-abcm.md)) : cette SFD n'a pas de sens seule.
- **Aucune alerte nouvelle** : l'anticipation des vacances reste au plan 33, où elle a déjà été
  arbitrée.
