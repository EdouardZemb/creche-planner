# 02 — Modèle de coût (frais de garde)

> Statut : **À valider** · Version 0.3 · 2026-06-02
> Source de vérité du **domaine métier**. Le code du `domain` en est la traduction
> directe et testable. Couvre **deux familles tarifaires** : crèche **PSU/CNAF** et
> **ABCM** (périscolaire / cantine / ALSH + frais annuels).

## 0. Jeu de données de référence (fictif)

| Donnée                                | Valeur                             | Origine       |
| ------------------------------------- | ---------------------------------- | ------------- |
| Ressources mensuelles retenues (CNAF) | **6 716,92 €**                     | Foyer         |
| Nombre d'enfants à charge             | **2**                              | Foyer         |
| Taux d'effort CNAF (2 enfants)        | **0,0516 %**                       | Barème CNAF   |
| **Revenu fiscal de référence (RFR)**  | **72 705 €**                       | Foyer         |
| **Tranche ABCM**                      | **Tranche 3 (> 50 000 €)**         | Déduit du RFR |
| Enfants                               | Mia (08/12/2024), Zoé (12/03/2023) | Foyer         |

> ⚠️ Le RFR et la tranche ABCM peuvent évoluer chaque année (réactualisés sur l'avis
> d'impôt). Ils sont des **données du Foyer**, pas des constantes du code.

## 1. Glossaire (Ubiquitous Language)

| Terme                        | Définition                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Foyer**                    | Porte composition (enfants) + données financières : ressources CNAF, RFR, nb enfants à charge, nb parts. |
| **Mode de garde**            | Type de prestation : `CRECHE_PSU`, `PERISCOLAIRE`, `CANTINE`, `ALSH`.                                    |
| **Prestataire**              | Structure : crèche Les Hirondelles (PSU), école ABCM.                                                    |
| **Tranche RFR**              | Classe de revenu ABCM (1 : <20 k€ ; 2 : 20–50 k€ ; 3 : >50 k€).                                          |
| **Taux d'effort**            | % horaire CNAF selon nb enfants à charge (mode PSU uniquement).                                          |
| **Tarif horaire (PSU)**      | `ressources × taux d'effort`. Ici 3,47 €/h.                                                              |
| **Mensualisation**           | Lissage des heures annuelles PSU sur N mensualités égales.                                               |
| **Séance / repas / journée** | Unité de facturation ABCM (péri matin/soir, repas cantine, journée ALSH).                                |
| **Frais fixes**              | Coûts annuels ABCM : cotisation, frais de 1ère inscription.                                              |
| **Politique tarifaire**      | Stratégie de calcul propre à un mode de garde (cf. doc 03 §5).                                           |
| **Ligne de coût**            | Élément atomique facturé (base, complément, déduction, séance, repas, frais).                            |

## 2. Règles transverses (questions tranchées)

- **Arrondi** : **au centime**, par ligne de coût, puis somme (Q-02 ✅).
- **Monnaie** : entiers de centimes en interne (type `Money`), jamais de flottant.
- **Durées** : minutes entières en interne (type `Duree`).
- **Coût mensuel foyer** = Σ sur (enfants × modes) des coûts mensuels + frais fixes
  rattachés au mois.

---

## 3. Mode CRÈCHE PSU (barème CNAF)

### 3.1 Formules

```
tarifHoraire        = borne(ressourcesMensuelles, plancher, plafond) × tauxEffort(nbEnfants)
heuresMensualisees  = heuresAnnuellesContractualisees / nbMensualites
mensualite          = heuresMensualisees × tarifHoraire

coutMois(M)         = mensualite
                      + heuresComplement(M) × tarifHoraire     # dépassement, à la minute
                      − heuresDeduites(M)   × tarifHoraire     # absences éligibles
```

### 3.2 Règles spécifiques (tranchées)

- **Dépassement horaire** : facturé **à la minute** (prorata exact, pas d'arrondi à
  l'heure) au `tarifHoraire` (Q-03 ✅).
- **Déduction d'absence** — éligible **uniquement** si (Q-01 ✅) :
  - absence **prévenue au moins 2 jours à l'avance** (délai de carence < 2 j ⇒ non déductible), **ou**
  - absence **pour maladie avec certificat médical**.
  - Sinon : l'absence reste facturée (incluse dans la mensualité, aucune déduction).
- **Taux d'effort** : barème CNAF par nb d'enfants à charge (cf. 3.3), borné par
  plancher/plafond annuels de ressources.

### 3.3 Barème taux d'effort (à maintenir par année — données du Référentiel)

| Nb enfants à charge | Taux horaire |
| ------------------- | ------------ |
| 1                   | 0,0619 %     |
| 2                   | **0,0516 %** |
| 3                   | 0,0413 %     |
| 4–7                 | 0,0310 %     |
| 8+                  | 0,0206 %     |

---

## 4. Mode ABCM — PÉRISCOLAIRE / CANTINE / ALSH

Tarifs **par tranche RFR**, Mulhouse, **Maternelle** (Zoé à la rentrée 2026).
Foyer = **Tranche 3**. Valeurs au 01/01/2026 (données du Référentiel, versionnées).

### 4.1 Cantine (par jour de déjeuner)

| Élément                                          | T1    | T2    | **T3**      |
| ------------------------------------------------ | ----- | ----- | ----------- |
| Maternelle TOTAL (repas + encadrement 12h–13h50) | 10,50 | 11,65 | **12,68 €** |

> `coutCantine(M) = nbJoursCantine(M) × tarifCantineTranche`. La ligne « TOTAL » est
> la valeur facturée (repas 4,66 € + garde 8,01 € = 12,67 ≈ 12,68, arrondi du barème).

### 4.2 Périscolaire (par séance, Maternelle Mulhouse)

| Séance     | T1   | T2   | **T3**     |
| ---------- | ---- | ---- | ---------- |
| Matin      | 2,31 | 2,87 | **3,33 €** |
| Soir (2 h) | 5,01 | 6,01 | **7,05 €** |

> `coutPeri(M) = Σ séances matin × tarifMatin + Σ séances soir × tarifSoir`.

### 4.3 ALSH / vacances / mercredi (par jour, toutes structures)

| Élément          | T1    | T2    | **T3**      |
| ---------------- | ----- | ----- | ----------- |
| Journée complète | 23,50 | 25,00 | **26,50 €** |
| ½ journée        | 8,50  | 9,00  | **9,50 €**  |
| Repas            | 6,50  | 7,00  | **7,50 €**  |

> Combinaisons d'inscription : matin · matin/midi · midi · midi/soir · soir · journée complète.

### 4.4 Frais fixes annuels ABCM

| Frais                                  | Montant   | Règle                                                                                                     |
| -------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Cotisation annuelle (1 enfant inscrit) | **286 €** | Période 1er sept → 31 août. **Rattachée en totalité au mois de septembre** (dépense ponctuelle, Q-06 ✅). |
| Frais de 1ère inscription              | **150 €** | **Uniquement la 1ère année** (2026/2027), sur septembre 2026.                                             |

> Septembre 2026 (Zoé) porte donc une charge fixe ponctuelle de **286 + 150 = 436 €**
> en plus des prestations (cantine/péri) du mois.

### 4.4 bis — Réservation, absences & règles de facturation ABCM (Q-09 ✅)

Source : règlement intérieur du périscolaire (AG 11/12/2025).

- **Réservation** : via portail famille **au plus tard le jeudi 12h00 pour la semaine
  suivante**. (Donnée de planification : une prestation au-delà du délai n'est pas garantie.)
- **Règle de base** : **toute prestation réservée est facturée**, que l'enfant soit
  présent ou non (`réservé ⇒ facturé`).
- **Déduction admise uniquement si** :
  - **maladie de l'enfant ou force majeure** (appréciée par le responsable), avec un
    **délai de carence de 48 h** ; _interprétation par défaut_ : les 48 premières heures
    restent dues, déduction au-delà (à confirmer sur facture réelle) ;
  - **interruption totale du service** (fermeture, grève, événement exceptionnel).
- **Jours d'ouverture** : école = **lundi, mardi, jeudi, vendredi** (hors fériés/vacances) ;
  **mercredi + vacances = ALSH**. Cantine 12h00–13h50 · péri matin 7h30–8h20 ·
  péri soir 16h30–18h15.
- **PAI panier-repas** (allergie/santé) : seule la part **« garde »** est facturée
  (T3 maternelle Mulhouse = 8,01 €/j) au lieu du TOTAL repas (12,68 €). Cas particulier.
- **Pénalités** (Annexe 2, hors coût nominal — modélisables en option) :
  présence cantine non réservée ⇒ tarif repas **+ 5 €** ; retard du soir répété ⇒ **+ 15 €**.
- **Révision tarifaire** : grilles valables pour l'année scolaire, **révisables au 1er janvier**
  ⇒ versionnement par date dans le Référentiel.

### 4.5 Unités Associatives (UA) — coût _conditionnel_ pilotable (Q-07 ✅)

Source : règlement intérieur ABCM, Annexe 2 (AG du 06/03/2026). **1 UA = 1 heure de bénévolat.**

| Donnée                 | Valeur (foyer = accès unique)                                                |
| ---------------------- | ---------------------------------------------------------------------------- |
| UA à réaliser / an     | **20 UA (= 20 h)**                                                           |
| Valeur d'une UA        | **31,25 €**                                                                  |
| Chèque de caution      | 625 € (= 20 × 31,25)                                                         |
| Période de réalisation | **1er juin → 31 mai** de l'année suivante                                    |
| Encaissement           | Caution conservée jusqu'à 2 mois après le 31 mai ; facturée si UA manquantes |

> Variantes : parent isolé 10 UA (caution 312,50 €) ; double accès portail 10 UA/parent.

**Modèle de coût** (ce n'est PAS un frais fixe) :

```
heuresManquantes = max(0, quotaUA − heuresRealisees)
coutUA           = heuresManquantes × valeurUA        # 31,25 €/h manquante
rattachement     = fin de période (mai 2027 pour 2026/2027)
```

- Si les 20 h sont réalisées ⇒ `coutUA = 0 €` (caution rendue).
- L'outil **planifie/suit** les heures de bénévolat réalisées et projette le **coût
  résiduel** ; c'est une grandeur **pilotable** (réduire le coût = faire ses heures).
- Hypothèse de projection par défaut : **objectif 20 h atteint ⇒ 0 €**, ajustable par saisie.

> Cotisation 2 enfants = 473 € / 3 enfants = 616 € (si Mia rejoint ABCM plus tard).

---

## 5. Invariants (garde-fous du domaine)

- `INV-01` Aucune durée/quantité négative ; toute plage `fin > début`.
- `INV-02` `tauxEffort` ∈ barème connu pour `nbEnfants ≥ 1` (mode PSU).
- `INV-03` `tranche RFR` ∈ {1,2,3} ; toute grille ABCM existe pour la tranche.
- `INV-04` Un jour de fermeture/non-scolaire ne porte pas de prestation facturable.
- `INV-05` `heuresDeduites(M) ≤ heures réservées contractuelles du mois`.
- `INV-06` Toute ligne de coût ≥ 0 ; coût mensuel ≥ 0.
- `INV-07` Montants = entiers de centimes en interne.
- `INV-08` Une déduction PSU n'existe que si la règle 3.2 est satisfaite (préavis 2 j OU certificat).

## 6. Cas de test de référence (oracle)

### PSU

- **CT-01** Tarif horaire : 6 716,92 × 0,0516 % = **3,47 €/h**.
- **CT-02** Mensualité Mia : 885,50/7 = 126,50 h × 3,47 = **438,96 €**.
- **CT-03** Mensualité Zoé (crèche) : 831,50/7 = 118,79 h × 3,47 = **412,20 €**.
- **CT-04** Total foyer crèche (mois standard) : **851,16 €**.
- **CT-05** Complément +1 h 23 min (83 min) Mia : 83/60 × 3,47 = 4,80 € → mensualité + 4,80 = **443,76 €** _(dépassement à la minute)_.
- **CT-06** Absence Zoé 1 jour **prévenue 3 j avant** (8 h déductibles) : 412,20 − 8 × 3,47 = **384,44 €**.
- **CT-07** Absence Zoé 1 jour **prévenue la veille** (carence) : **412,20 €** (non déductible).
- **CT-08** Absence maladie 2 jours **avec certificat** (16 h) : 412,20 − 16 × 3,47 = **356,68 €**.

### ABCM (Zoé, Tranche 3, Maternelle)

- **CT-10** Cantine 4 jours/sem × 4 sem = 16 jours : 16 × 12,68 = **202,88 €/mois**.
- **CT-11** Périscolaire soir ×12 + matin ×8 : 12 × 7,05 + 8 × 3,33 = 84,60 + 26,64 = **111,24 €**.
- **CT-12** ALSH 5 jours complets (vacances) : 5 × 26,50 = **132,50 €**.
- **CT-13** Cotisation annuelle 1 enfant : **286 €** (rattachée à septembre).
- **CT-14** Frais 1ère inscription : **150 €** (sept. 2026 uniquement).
- **CT-15** UA : 14 h réalisées sur 20 ⇒ (20 − 14) × 31,25 = **187,50 €** (mai 2027).
- **CT-16** UA : 20 h réalisées ⇒ **0 €** (caution rendue).
- **CT-17** Cantine réservée mais enfant absent **sans justificatif** ⇒ **facturée** (réservé = facturé).
- **CT-18** Cantine PAI panier-repas, 16 j ⇒ 16 × 8,01 = **128,16 €** (part garde seule).

### Consolidation

- **CT-20** Coût garde du foyer pour un mois mixte = Σ (crèche Mia + crèche Zoé
  jusqu'à l'été) puis, dès sept. 2026, (crèche Mia + ABCM Zoé : cantine + péri + frais).

## 7. Semaines types / données contractuelles (réel)

### Crèche — Mia 32 h 30 / sem · Zoé 30 h 30 / sem

| Jour     | Mia                  | Zoé                  |
| -------- | -------------------- | -------------------- |
| Lundi    | 09:00–16:30 (7 h 30) | 11:00–16:30 (5 h 30) |
| Mercredi | 08:30–17:00 (8 h 30) | 08:30–17:00 (8 h 30) |
| Jeudi    | 08:30–16:30 (8 h 00) | 08:30–16:30 (8 h 00) |
| Vendredi | 08:30–17:00 (8 h 30) | 08:30–17:00 (8 h 30) |

Contrat crèche : 01/01/2026 → 31/07/2026 · 29 sem · 109 j · 7 mensualités.
Fermetures 2026 : 01/01, 02–04/01, 06/04, 01/05, 08/05, 14/05, 15–17/05, 25/05, 14/07, 27–31/07.

### ABCM (Zoé) — à partir de la rentrée **septembre 2026**

Planning à saisir : jours de cantine, séances péri (matin/soir), jours ALSH (vacances/mercredi).
Calendrier scolaire ABCM (jours d'école, vacances) = donnée du Référentiel (`Q-08`).

## 8. Transition crèche → école (Zoé) — tranché

- Zoé **quitte la crèche** : son contrat crèche court jusqu'au **31/07/2026**, puis
  elle démarre l'**école ABCM en septembre 2026**. **Aucun chevauchement** (Q-10 ✅).
- Conséquence sur la projection : à partir de septembre, le coût de Zoé bascule
  entièrement du PSU vers l'ABCM (cantine + péri + ALSH + frais fixes de septembre).
- Mia reste en crèche (son parcours école sera traité ultérieurement).

## 9. Calendrier scolaire (Q-08 ✅ — source fixée)

- Mulhouse dépend de l'**académie de Strasbourg ⇒ Zone B**.
- Source : **calendrier scolaire officiel 2026/2027, Zone B** (jours d'école, vacances,
  fériés). À **amorcer dans le Référentiel** (données versionnées par année scolaire).
- ⏳ Dates exactes à figer (recherche web temporairement indisponible — à compléter).
- _Réserve_ : ABCM pourrait avoir des fermetures propres ; à confirmer le cas échéant.

## 10. Questions ouvertes restantes

- `Q-05` Les ressources/RFR/tranche changent-ils en cours d'année (recalcul) ?
- `Q-11` Interprétation exacte du **délai de carence 48 h** ABCM (48 premières heures dues,
  puis déduction ? ou notification sous 48 h ?) — à confirmer sur une facture réelle.
- _(Q-09 tranchée : réservé = facturé ; déduction si maladie/force majeure (carence 48 h)
  ou interruption de service. Q-08 source = calendrier officiel Zone B, dates à figer.)_
