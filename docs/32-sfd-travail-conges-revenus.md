# 32 — SFD Travail des parents : contrats, absences, congés & revenus du foyer

> Statut : **Brouillon — à valider PO** · Version 0.1 · 2026-07-19
> S'appuie sur le versionnement à date d'effet (doc 30). Alimente le planning famille
> (doc 33). Premier lot du volet « revenus » de la vision plateforme budget (doc 01 §1).

## 1. Contexte & vision

Le foyer de référence compte deux parents salariés dans **deux systèmes juridiques
différents** :

- **Parent A (cas réel : Edouard)** — CDI français (Onepoint SAS), convention
  **Syntec-Cinov** (IDCC 1486), ETAM position 3.1 coefficient 400, **35 h/semaine sans
  RTT**, embauche 18/03/2024, télétravail quasi complet (déplacements ponctuels),
  rémunération 12 mensualités avec prime de vacances mensualisée (bulletin 04/2026 :
  brut 2 916,67 €, net avant impôt 2 141,85 €, compteurs CP N-1/N affichés).
- **Parent B (cas réel : Anna-Louise)** — contrat suisse permanent (Sulzer Chemtech Ltd,
  Allschwil BL), **frontalière** (résidence Mulhouse), **taux d'activité 40 % =
  16 h/semaine**, base fixe + exceptions, salaire mensuel **CHF 2 700 brut** +
  **13e salaire garanti en novembre**, droit vacances **25 jours (5 semaines)** au
  prorata du taux d'activité, compteur d'heures supplémentaires récupérables.

L'application doit gérer ce cas **en priorité**, mais via des abstractions : « Syntec »,
« Code des obligations suisse », « Sulzer », « Onepoint » sont des **instances de
paramétrage**, jamais des branches de code (principe doc 30 §4). Ajouter un régime
(autre convention, autre pays, fonction publique…) = créer un paramétrage, pas coder.

## 2. Périmètre

### Dans le périmètre (v1)

- **Employeurs** et **contrats de travail** versionnés (avenants à date d'effet).
- **Planning de travail** : semaine type (jours, créneaux, lieu) + exceptions ponctuelles.
- **Absences typées** : congés payés/vacances, sans solde, rattrapage d'heures sup,
  maladie justifiée, maladie non justifiée — catalogue extensible.
- **Compteurs** : solde de congés par régime (moteur de règles + recalage sur fiche de
  paie), compteur d'heures +/− pour les heures supplémentaires récupérables.
- **Revenus du foyer** : réel mensuel (montants versés, multi-devises) + prévisionnel
  (contrat + impact des absences), consolidation EUR, deux vues (avant impôt /
  estimation après impôt).

### Hors périmètre (v1) — backlog

- Calcul précis de l'impôt (PAS, barème frontalier) — v1 = taux moyen paramétrable.
- Autres types d'absence (congé enfant malade, formation, congés familiaux) — le
  catalogue extensible les accueillera.
- Génération de demandes de congés vers l'employeur ; import automatique des bulletins.
- Primes variables, intéressement, notes de frais.

## 3. Abstractions & modèle

```
Parent ──< ContratTravail (versionné, doc 30)
              ├─ Employeur (nom, pays, devise de paie)         ← Onepoint/Sulzer = instances
              ├─ TempsDeTravail (taux d'activité, h/semaine,
              │    SemaineTypeTravail + ExceptionsPlanning)
              ├─ Rémunération (brut périodique, composantes
              │    récurrentes : 13e mois, prime mensualisée…)
              ├─ RégimeCongés (paramétrage)                    ← « FR légal/Syntec », « CH CO/5 sem. » = instances
              ├─ RégimeAbsences (catalogue de types + effets)
              └─ CompteurHeures (optionnel, si récupération d'heures)
Parent ──< Absence (type, dates/durée, justificatif o/n)
Parent ──< PointDeRecalage (date, compteurs officiels de la fiche de paie)
Parent ──< RevenuMensuel (réel : montants versés ; devise + contre-valeur EUR reçue)
```

### 3.1 RégimeCongés — moteur de règles paramétré (validé PO : moteur + recalage paie)

Un régime définit : l'**unité de décompte** (jours ouvrés ou heures), le **rythme
d'acquisition**, la **période de référence**, les **compteurs** exposés.

| Paramètre            | Instance « FR — légal/Syntec » (Parent A)                        | Instance « CH — CO/règlement employeur » (Parent B)                                  |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Unité de décompte    | Jours ouvrés                                                     | **Heures** (recommandé pour temps partiel : droit annuel = 5 sem. × 16 h = **80 h**) |
| Acquisition          | 2,08 j ouvrés/mois travaillé (25 j/an)                           | Au prorata mensuel du droit annuel (≈ 6,67 h/mois)                                   |
| Période de référence | 1er juin → 31 mai, compteurs **N−1** et **N** distincts          | Année civile, un seul compteur                                                       |
| Ancienneté           | Jours supplémentaires conventionnels (à paramétrer, cf. Q-32-01) | —                                                                                    |
| Prise                | Décompte en jours ouvrés du planning                             | Décompte des heures planifiées des jours posés                                       |

- Le moteur calcule le **solde théorique** à toute date (acquisition − prises).
- **Recalage** : à chaque bulletin, le parent peut saisir les compteurs officiels
  (ex. bulletin 04/2026 Parent A : N−1 acquis 11/pris 11/solde 0 ; N acquis 22,88/pris
  11/solde 11,88). Le point de recalage devient la nouvelle base ; l'écart
  théorique/officiel est affiché, jamais corrigé silencieusement.

### 3.2 RégimeAbsences — catalogue typé à effets (validé PO : impact compteurs + revenus)

Chaque type d'absence est une **donnée** : libellé, compteur décrémenté (ou aucun),
effet revenu, exigence de justificatif.

| Type (instances v1)       | Compteur               | Effet revenu prévisionnel                                                                                                                     | Justificatif     |
| ------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Congé payé / vacances     | Solde congés           | Aucun (salaire maintenu)                                                                                                                      | Non              |
| Sans solde                | —                      | Retenue au prorata (jours ou heures non payés)                                                                                                | Non              |
| Rattrapage heures sup     | **CompteurHeures** (−) | Aucun                                                                                                                                         | Non              |
| Maladie **justifiée**     | —                      | Selon régime : carence + maintien paramétrés (FR : carence IJSS + maintien conventionnel ; CH : couverture assurance perte de gain employeur) | Oui (certificat) |
| Maladie **non justifiée** | —                      | Traitée comme sans solde                                                                                                                      | —                |

### 3.3 CompteurHeures (heures supplémentaires récupérables — Parent B)

- Les heures effectuées **au-delà du planning** sont saisies (date, durée) et créditent
  le compteur ; une absence « rattrapage » le débite des heures planifiées du créneau.
- Recalage possible sur le solde communiqué par l'employeur (même mécanique que 3.1).

### 3.4 Revenus du foyer (validé PO : montant reçu + taux de référence ; deux vues impôt)

- **Réel** : par mois et par parent, le net versé. Pour une paie en devise étrangère :
  montant en devise **et** contre-valeur EUR effectivement reçue après change (le taux
  réel constaté prime ; ex. avril 2026 Parent B : CHF 2 323,95 versés).
- **Prévisionnel** : dérivé du contrat versionné (brut → net estimé par un coefficient
  paramétrable calé sur les derniers bulletins), des composantes récurrentes (13e
  salaire en novembre, pro rata la 1re année) et des absences à effet revenu (§3.2).
- **Conversion** : pour les mois futurs, un **taux de référence paramétrable**
  (saisi, éventuellement pré-rempli d'une source de marché) ; le réel utilise toujours
  le montant constaté.
- **Deux vues** : ① net avant impôt (consolidation des nets versés) ; ② **estimation
  après impôt** via un taux moyen paramétrable **par parent**, saisi depuis l'avis
  d'imposition (cas frontalier : salaire suisse imposé en France, donc même mécanique).

## 4. Acteurs

| Acteur      | Rôle                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **Parent**  | Gère les contrats/avenants, pose les absences, saisit heures sup et recalages, consulte soldes et revenus        |
| **Système** | Applique les régimes paramétrés, tient les compteurs, calcule réel/prévisionnel, publie vers le planning famille |

## 5. User stories

### US-32-01 — Déclarer un contrat de travail

En tant que parent, je crée un employeur puis un contrat : dates, taux d'activité,
semaine type (jours/créneaux/lieu : domicile, site, déplacement), rémunération, régime
de congés et catalogue d'absences.

- **CA1** : les deux contrats du cas de référence sont représentables sans champ « autre »
  fourre-tout (§1).
- **CA2** : un avenant (ex. passage 40 % → 60 %) est une nouvelle version à date d'effet
  (doc 30) : soldes et revenus changent à partir de cette date, l'historique est intact.
- **CA3** : la semaine type accepte un lieu par défaut par créneau (télétravail pour
  Parent A ; site pour Parent B) et des exceptions ponctuelles (déplacement, échange de
  jour).

### US-32-02 — Poser une absence

En tant que parent, je pose une absence typée sur un ou plusieurs jours (ou un créneau).

- **CA1** : un CP posé décrémente le bon compteur selon le régime (jours ouvrés N−1
  d'abord puis N pour l'instance FR ; heures planifiées pour l'instance CH).
- **CA2** : une absence « rattrapage » est refusée si le compteur d'heures est
  insuffisant (sauf confirmation explicite → solde négatif signalé).
- **CA3** : une maladie non justifiée est requalifiable en justifiée à réception du
  certificat (bascule d'effet revenu recalculée).
- **CA4** : l'absence apparaît dans le planning famille (doc 33) le jour même de sa
  saisie.

### US-32-03 — Suivre mes soldes

En tant que parent, je consulte mes soldes (congés par période de référence, heures) à
aujourd'hui **et en projection** à une date future.

- **CA1** : « puis-je poser 2 semaines en août ? » → projection du solde au 1er août
  (acquisition future incluse) moins les absences déjà posées.
- **CA2** : l'écart entre solde théorique et dernier recalage officiel est visible avec
  la date du dernier recalage.

### US-32-04 — Recaler sur la fiche de paie

En tant que parent, je saisis chaque mois les compteurs officiels du bulletin.

- **CA1** : saisie des compteurs du bulletin (acquis/pris/solde par compteur) en moins
  d'une minute ; l'écart éventuel est affiché immédiatement.
- **CA2** : le net versé saisi au même moment alimente le revenu réel du mois.

### US-32-05 — Saisir des heures supplémentaires

En tant que parent B, je déclare les heures faites au-delà du planning.

- **CA1** : le compteur reflète immédiatement le crédit ; l'historique
  crédit/débit/recalage est consultable.

### US-32-06 — Consulter les revenus du foyer

En tant que parent, je vois par mois : le réel (nets versés, contre-valeurs EUR), le
prévisionnel des mois futurs, le consolidé foyer, en vue avant impôt et estimation
après impôt.

- **CA1** : novembre affiche le 13e salaire du Parent B dans le prévisionnel.
- **CA2** : une absence sans solde posée sur un mois futur réduit le prévisionnel de ce
  mois au prorata.
- **CA3** : le consolidé peut être rapproché des frais de garde du même mois (coûts
  doc 02) — première brique « reste à vivre » de la vision budget.
- **CA4** : chaque montant estimé est visuellement distinct d'un montant réel constaté.

## 6. Règles métier

- **RM-32-01** Aucun régime en dur : conventions, législations et règlements employeur
  sont des instances de paramétrage versionnées (doc 30) ; les valeurs par défaut
  proposées (25 j FR, 5 semaines CH…) sont des **modèles de paramétrage** livrés en
  données.
- **RM-32-02** Le recalage officiel prime toujours sur le théorique ; l'app n'écrase
  jamais un compteur officiel, elle affiche l'écart.
- **RM-32-03** Multi-devises : montants stockés dans la devise d'origine (centimes) ;
  la contre-valeur EUR réelle est une donnée constatée, jamais recalculée a posteriori.
- **RM-32-04** Les montants prévisionnels utilisent la version de contrat en vigueur le
  mois projeté (RM-30-01).
- **RM-32-05** Confidentialité : les données de travail/revenus relèvent du foyer
  (isolation foyer existante) ; chaque parent voit les données des deux parents du foyer
  (modèle de confiance actuel), à re-trancher si le produit devient multi-foyer public.
- **RM-32-06** Un jour peut combiner travail et exceptions par créneau (demi-journée
  posée) — le grain minimal est le créneau, aligné sur le planning de garde.

## 7. Questions ouvertes

- **Q-32-01** Jours d'ancienneté conventionnels du Parent A (Syntec, embauche 03/2024) :
  paramétrer maintenant la règle d'acquisition ou attendre l'échéance ? (proposé :
  champ « jours supplémentaires/an » simple, enrichi plus tard)
- **Q-32-02** Maintien de salaire maladie : quelles valeurs exactes paramétrer
  (FR : carence/maintien conventionnels selon ancienneté ; CH : couverture réelle de
  l'assurance perte de gain de l'employeur) ? → v1 : paramètres saisissables avec
  valeurs par défaut prudentes, à affiner sur premier cas réel.
- **Q-32-03** Le règlement employeur du Parent B (25 jours confirmés PO) prévoit-il des
  jours fériés cantonaux payés distincts (Bâle-Campagne) à intégrer au calendrier de
  travail ?
- **Q-32-04** Saisie du planning « base fixe + exceptions » du Parent B : faut-il un
  rappel mensuel de confirmation du planning à venir (lien avec notifications
  existantes) ?
