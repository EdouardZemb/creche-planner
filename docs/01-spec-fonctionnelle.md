# 01 — Spécification fonctionnelle

> Statut : **À valider** · Version 0.2 · 2026-06-02
> Décrit le _quoi_ et le _pourquoi_. Le _comment_ est dans les docs 02/03/04.

## 1. Contexte & vision

Premier lot d'une future **plateforme de budget du foyer**. Ce lot couvre les
**frais de garde** d'un foyer type de référence (fictif) à deux enfants —
Mia (08/12/2024) et Zoé (12/03/2023) :

- **Crèche Les Hirondelles** (PSU/CNAF) : les deux enfants, jusqu'à l'été 2026.
- **École ABCM** (grille Mulhouse) : l'aînée en maternelle — **périscolaire,
  cantine, ALSH** + frais annuels.

Le coût n'est pas un prix catalogue : il dépend des **ressources / du RFR du foyer**,
du **nombre d'enfants à charge**, du **mode de garde**, et d'un **planning** d'heures /
séances / repas. Besoin : un outil qui rend ce calcul lisible et permet de **simuler**
l'impact d'un changement de planning sur le budget mensuel.

## 2. Périmètre

### Dans le périmètre (v1)

- **Foyer** : ressources mensuelles CNAF, RFR + tranche, nb enfants à charge, nb parts.
- **Enfants** et leurs **modes de garde** actifs (crèche / ABCM).
- **Crèche (PSU)** : contrat d'accueil (semaine type, période, mensualités, tarif horaire),
  compléments horaires (à la minute), déductions d'absence éligibles.
- **ABCM** : planning **périscolaire** (matin/soir), **cantine** (repas), **ALSH**
  (journée/½ journée, mercredis & vacances), **frais fixes** (cotisation, 1ère inscription).
- **Unités Associatives (UA)** : suivi des heures de bénévolat (objectif 20 h/an) et
  projection du **coût résiduel conditionnel** (heures manquantes × 31,25 €).
- **Calcul du coût mensuel** par enfant, par mode, **consolidé foyer**.
- **Simulation** : « +1 jour cantine », « −1 semaine crèche prévenue », « Zoé passe à
  l'école en septembre » → impact € immédiat.
- **Projection annuelle** (mensualités crèche + frais ABCM lissés/ponctuels).

### Hors périmètre (v1) — backlog

- Autres sous-domaines budget (charges, crédits, revenus) — lots suivants.
- Multi-comptes/multi-familles (outil mono-foyer).
- Recalcul auto du tarif/tranche depuis les avis (saisie manuelle en v1).
- Paiement, facturation officielle, intégration portails (CAF, delta-enfance).
- Crédit d'impôt frais de garde (calculable plus tard à partir des coûts).

## 3. Acteurs

| Acteur                          | Description                                                 |
| ------------------------------- | ----------------------------------------------------------- |
| **Parent** (utilisateur unique) | Saisit, consulte plannings & coûts, simule.                 |
| **Système**                     | Calcule les coûts selon les politiques tarifaires (doc 02). |

## 4. User stories

### US-01 — Définir le foyer

Enregistrer ressources CNAF, RFR (→ tranche), nb enfants à charge, nb parts.

- **CA1** : ressources 6 716,92 € + 2 enfants ⇒ tarif PSU **3,47 €/h**.
- **CA2** : RFR 72 705 € ⇒ **Tranche 3** ABCM (auto depuis les seuils 20 k/50 k).

### US-02 — Contrat crèche (PSU)

Saisir semaine type, période, nb mensualités ⇒ mensualité lissée.

- **CA1** Σ plages = total hebdo (Mia 32 h 30, Zoé 30 h 30).
- **CA2** `mensualité = (heures annuelles / nb mensualités) × tarif` (Mia 438,96 €, Zoé 412,20 €).
- **CA3** Jours de fermeture exclus du planning.

### US-03 — Planifier la crèche

Calendrier mensuel pré-rempli par la semaine type ; ajout/retrait de jours, ajustement horaire.

- **CA1** Fermetures grisées/non sélectionnables.
- **CA2** Dépassement horaire compté **à la minute**.
- **CA3** Absence marquée déductible **si** prévenue ≥ 2 j **ou** maladie + certificat ; sinon facturée.

### US-04 — Planifier l'ABCM (Zoé, dès sept. 2026)

Saisir par jour : cantine (repas), périscolaire (matin/soir), ALSH (mercredis/vacances).

- **CA1** Seuls les jours scolaires/ouverts sont sélectionnables (calendrier scolaire).
- **CA2** Tarifs appliqués selon la **tranche** du foyer (T3) et le type maternelle.

### US-05 — Calculer le coût d'un mois

Détail par enfant, par mode, total foyer.

- **CA1** PSU : mensualité + compléments − déductions éligibles.
- **CA2** ABCM : Σ (cantine + péri + ALSH) + frais fixes rattachés au mois.
- **CA3** Détail ligne à ligne + total foyer.

### US-06 — Simuler

Modifier un planning en mode simulation sans altérer le réel ; afficher le **delta €/quantités**.

- **CA1** Quitter sans enregistrer ne modifie rien.

### US-07 — Projeter sur l'année

Vue par mois + cumul, incluant la transition crèche → école de Zoé.

- **CA1** Σ mensualités crèche = montant contractuel ; frais ABCM correctement positionnés.

## 5. Règles métier transverses

- **RM-01** Le tarif PSU dépend des ressources + nb enfants ; les tarifs ABCM de la tranche RFR.
- **RM-02** Crèche : facturation mensuelle à terme échu, mensualité lissée + régularisations.
- **RM-03** Déduction d'absence crèche : préavis ≥ 2 j **ou** maladie + certificat (sinon facturée).
- **RM-04** Dépassement horaire crèche : à la minute.
- **RM-05** Arrondi au centime par ligne ; durées en minutes, monnaie en centimes en interne.
- **RM-06** Frais fixes ABCM : cotisation annuelle + frais 1ère inscription (1ère année).
- **RM-07** ABCM : réservation au plus tard **jeudi 12h pour la semaine suivante** ; **réservé = facturé** ;
  déduction si maladie/force majeure (carence 48 h) ou interruption de service.
- **RM-08** Jours ABCM : école lundi/mardi/jeudi/vendredi ; mercredi & vacances = ALSH.

## 6. Questions ouvertes

_(Tranchées : Q-01 préavis 2 j/maladie · Q-02 arrondi centime · Q-03 dépassement minute ·
Q-04 grain à 4 services · Q-06 cotisation rattachée à septembre · Q-07 UA = coût conditionnel
pilotable (20 h ; manquantes × 31,25 €) · Q-08 calendrier officiel Zone B / acad. Strasbourg ·
Q-09 réservé=facturé / déduction maladie-force majeure (carence 48 h) ou interruption ·
Q-10 Zoé quitte la crèche fin de contrat 31/07, école en sept., sans chevauchement.)_

- `Q-05` Les ressources/RFR/tranche changent-ils en cours d'année (recalcul) ?
- `Q-11` Interprétation exacte du délai de carence 48 h ABCM (à confirmer sur facture réelle).

## 7. Critères de succès produit

1. Reproduire **exactement** les mensualités crèche (Mia 438,96 €, Zoé 412,20 €).
2. Calculer correctement un mois ABCM type pour Zoé en T3 (cantine + péri).
3. Visualiser la **transition** crèche → école de Zoé sur la projection annuelle.
4. Simulation en moins de 3 clics, sans ressaisie (planning pré-rempli).
