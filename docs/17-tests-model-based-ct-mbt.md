# 17 — Tests Model-Based (audit CT-MBT)

> Statut : **Réalisé** · Version 0.1 · 2026-06-07
> Décrit la couche de tests **model-based** ajoutée au domaine, menée au prisme
> **ISTQB® CT-MBT** (Certified Tester – Model-Based Tester). Le domaine était **déjà**
> couvert à 100 % par des tests classiques (cf. [doc 06](06-etat-davancement.md)) ; cette
> phase **ajoute** une couche _model-based_ explicite — des **modèles** dont on dérive
> systématiquement les cas selon un **critère de couverture** déclaré. Les modèles sont la
> traduction testable du métier de la [doc 02](02-modele-de-cout.md). Même esprit que le
> précédent audit ISTQB du dépôt ([doc 11 — CT-UT](11-spec-accessibilite-ct-ut.md) /
> [doc 12](12-plan-implementation-accessibilite.md)) : conformité **prouvée**, pas supposée.

## 1. Objet & démarche CT-MBT

### 1.1 Pourquoi une couche model-based

Les quatre libs domaine (`shared-kernel`, `foyer/domain`, `planification/domain`,
`tarification/domain`) étaient déjà à **100 % de couverture** via des tests d'exemple
(oracle CT-01..20 de la doc 02). Ces tests valident des **cas choisis** ; ils ne rendent
pas explicite **le modèle** ni **le critère** qui justifie le choix des cas. Le syllabus
ISTQB **CT-MBT** propose une démarche complémentaire : on **modélise** le comportement
attendu (machine à états, table de décision, partition d'équivalence + valeurs limites,
invariant), puis on **dérive** les cas à partir d'un **critère de couverture du modèle**,
de façon systématique et traçable.

La valeur ajoutée n'est donc pas un gain de couverture de ligne (déjà à 100 %), mais une
**couverture de modèle** : transitions d'états (0-switch / 1-switch), combinaisons
complètes de conditions (tables de décision), 3 points par borne (BVA), et **propriétés
universelles** (invariants vérifiés sur des milliers d'entrées générées).

### 1.2 Workflow MBT appliqué

Pour chaque SUT (System Under Test = un fichier source du domaine) :

1. **Modélisation** — identifier le type de modèle pertinent au regard de la doc 02 :
   machine à états (entité avec transitions), table de décision (sortie = combinaison de
   conditions), BVA / partition d'équivalence (calcul borné), ou invariant (propriété
   vraie pour toute entrée).
2. **Choix du critère de couverture** — déclaré explicitement par modèle : 0-switch +
   1-switch pour les machines à états ; combinatoire complète pour les tables de décision ;
   3 points par borne pour la BVA ; génération aléatoire bornée pour les propriétés.
3. **Génération / dérivation des cas** — les cas découlent du critère, pas d'une intuition.
4. **Exécution** — `vitest` (mêmes seuils, mêmes commandes `nx test`).

### 1.3 Outils

- **`it.each` (tabulaire, data-driven)** — pour les tables de décision et la BVA : chaque
  ligne du tableau est un cas dérivé du modèle ; le tableau **est** la table de décision /
  la liste des points de borne, lisible côté revue.
- **`fast-check` 4.8** — property-based : `fc.assert(fc.property(...))` pour les invariants
  (oracles universels), et **machines à états** via `fc.commands` / `fc.modelRun` (chaque
  commande = une transition ; le runner explore des **séquences** de transitions, ce qui
  réalise mécaniquement le critère 0-switch / 1-switch et au-delà).

> Note d'outillage (cf. §4) : `nx test` **exécute** les specs mais ne **type-check** pas
> aussi strictement que `nx typecheck`. Les specs MBT doivent passer **les deux** cibles.

## 2. Catalogue des modèles

Chaque modèle porte un **ID**, son **SUT** (fichier source), une **description** et le
**critère de couverture visé**.

### 2.1 Machines à états (state machines)

| ID     | SUT                                                   | Description                                                                                         | Critère de couverture                                     |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| SM-01  | `libs/foyer/domain/src/lib/foyer.ts`                  | `Foyer` : transitions `actualiserRfr` / `ajouterEnfant` ; vérifie l'**immuabilité** (non-mutation). | **0-switch + 1-switch** (séquences via `fc.modelRun`)     |
| SM-03  | `libs/planification/domain/src/lib/contrat-creche.ts` | `ContratCreche` : états **AVANT / DANS / APRÈS** la période de validité (mois courant vs bornes).   | **0-switch** + BVA 3 points sur les **bornes mensuelles** |
| SM-SYS | saisie de planning (E2E, `apps/web`)                  | Modèle d'état **système** S0..S4 de la saisie de planning (UI → BFF → projection serveur).          | **0-switch + persistance** (réhydratation après reload)   |

> SM-01 combine deux approches : génération de **séquences de commandes** (`fc.commands` /
> `fc.modelRun`, qui couvre 0-switch et 1-switch en explorant des enchaînements) **et** une
> dérivation **tabulaire** des transitions nommées (lisibilité). SM-03 modélise le statut du
> contrat par rapport au mois ; les transitions de statut sont ancrées sur les **bornes
> mensuelles** (premier/dernier mois de validité), d'où la BVA 3 points. SM-SYS est un modèle
> **système** (bout en bout) : l'état persistant après un `reload` doit refléter la saisie
> (réhydratation depuis le serveur), pas seulement l'état local.

### 2.2 Tables de décision (decision tables)

Sortie = combinaison de conditions ; **critère : couverture combinatoire complète** (toutes
les combinaisons pertinentes de conditions, pas seulement les cas « heureux »).

| ID    | SUT                                                                 | Décision modélisée                                                                                      |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| DT-01 | `libs/shared-kernel/src/lib/tranche.ts`                             | Tranche RFR depuis le revenu (1 : <20 k€ ; 2 : 20–50 k€ ; 3 : >50 k€).                                  |
| DT-02 | `libs/foyer/domain/src/lib/foyer.ts`                                | `Foyer.creer` : validité de la saisie (ressources / RFR / nb enfants / nb parts).                       |
| DT-03 | `libs/foyer/domain/src/lib/enfant.ts`                               | `Enfant.creer` : validité (prénom, date de naissance).                                                  |
| DT-04 | `libs/planification/domain/src/lib/contrat-creche.ts`               | Éligibilité d'une **déduction d'absence** PSU : table de vérité **préavis × certificat** (doc 02 §3.2). |
| DT-05 | `libs/planification/domain/src/lib/inscription-abcm.ts`             | Héritage / **exception** ABCM (opérateur `??` : valeur de séance par défaut vs surcharge).              |
| DT-07 | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.ts`         | **Bornage** des ressources PSU (plancher / dans / plafond).                                             |
| DT-08 | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.ts`         | **Taux d'effort par paliers** (nb enfants à charge → taux, doc 02 §3.3).                                |
| DT-09 | `libs/tarification/domain/src/lib/abcm/tarif-cantine-abcm.ts`       | Cantine **PAI × tranche** (part garde seule si PAI, sinon TOTAL × tranche).                             |
| DT-10 | `libs/planification/domain/src/lib/inscription-abcm.ts`             | ALSH **type de journée × repas** (combinaisons matin/midi/soir/journée + repas).                        |
| DT-11 | `libs/tarification/domain/src/lib/abcm/frais-fixes-abcm.ts`         | Frais fixes ABCM rattachés à **septembre** (cotisation + 1ʳᵉ inscription) vs autres mois.               |
| DT-12 | `libs/tarification/domain/src/lib/abcm/unites-associatives-abcm.ts` | **Quota UA** : heures réalisées vs quota → coût résiduel (0 si quota atteint).                          |

### 2.3 BVA / partitions d'équivalence

**Critère : 3 points par borne** (valeur juste sous la borne, sur la borne, juste au-dessus),
en plus d'un représentant par partition d'équivalence.

| ID         | SUT                                                                            | Frontière(s) modélisée(s)                                                                          |
| ---------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| BVA-01/03  | `libs/shared-kernel/src/lib/money.ts`                                          | Arrondis `Money` au centime (sens de l'arrondi autour du demi-centime).                            |
| BVA-02     | `libs/shared-kernel/src/lib/duree.ts`                                          | `Duree.entre(début, fin)` : bornes (fin = début, fin < début, fin > début).                        |
| BVA-04/05  | `libs/foyer/domain/src/lib/foyer.ts`                                           | Frontières `Foyer` : nb enfants à charge (≥ 1), nb parts (> 0).                                    |
| BVA-08     | `libs/planification/domain/src/lib/contrat-creche.ts`                          | INV-05 : `heuresDeduites(M) ≤ heures réservées du mois` (borne supérieure).                        |
| BVA-09     | `libs/planification/domain/src/lib/contrat-creche.ts`                          | Agrégation mensuelle des heures (somme sur les jours réservés).                                    |
| BVA-10     | `libs/planification/domain/src/lib/inscription-abcm.ts`                        | Jour **facturable** vs non facturable (frontière d'éligibilité, INV-04).                           |
| BVA-11     | `libs/planification/domain/src/lib/inscription-abcm.ts`                        | Décompte des **séances péri** (matin / soir) sur le mois.                                          |
| BVA-13..16 | `libs/tarification/domain/src/lib/psu/{bareme-effort-psu,tarif-creche-psu}.ts` | Calculs PSU / grille : bornes plancher/plafond, tarif horaire, mensualité, complément à la minute. |
| BVA-17     | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.ts`                    | Paliers du barème de taux d'effort (transitions entre paliers).                                    |

### 2.4 Property-based (oracles d'invariants)

**Critère : génération aléatoire bornée** (`fast-check`), chaque propriété encode un
**invariant universel** de la doc 02 §5.

| Propriété                          | SUT                                                                 | Invariant / propriété vérifié(e)                                      |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| INV-01 (Money)                     | `libs/shared-kernel/src/lib/money.ts`                               | Montant ≥ 0, entier de centimes (jamais de flottant).                 |
| INV-01 (Duree)                     | `libs/shared-kernel/src/lib/duree.ts`                               | Durée ≥ 0, minutes entières ; plage `fin > début`.                    |
| Round-trip                         | `libs/shared-kernel/src/lib/{money,duree}.ts`                       | `depuis(x).vers()` ≡ `x` (sérialisation/désérialisation idempotente). |
| Monotonie Tranche                  | `libs/shared-kernel/src/lib/tranche.ts`                             | RFR croissant ⇒ tranche croissante (jamais décroissante).             |
| Cohérence dérivation tranche Foyer | `libs/foyer/domain/src/lib/foyer.ts`                                | La tranche d'un Foyer = `Tranche.depuisRfr(rfr)` (pas de divergence). |
| INV-04                             | `libs/planification/domain/src/lib/inscription-abcm.ts`             | Un jour non facturable n'est **jamais** compté en prestation.         |
| INV-05                             | `libs/planification/domain/src/lib/contrat-creche.ts`               | Heures déduites ≤ heures réservées du mois (jamais de sur-déduction). |
| Héritage exception invariant       | `libs/planification/domain/src/lib/inscription-abcm.ts`             | La surcharge (`??`) ne crée jamais de valeur hors domaine.            |
| INV-06 (CoutMois)                  | `libs/tarification/domain/src/lib/core/cout-mois.ts`                | Total `CoutMois` ≥ 0 (toute ligne ≥ 0, somme ≥ 0).                    |
| Consolidation = somme              | `libs/tarification/domain/src/lib/consolidation/cout-mois-foyer.ts` | `consoliderCoutMoisFoyer(couts)` = somme exacte des coûts d'entrée.   |

### 2.5 Traçabilité explicite des invariants `INV-01..08`

> Les sections 2.1–2.4 tracent les invariants **par modèle** (BVA / table de décision / propriété).
> Ce tableau les indexe **par ID d'invariant** (doc 02 §5) pour une traçabilité **exhaustive et
> auditable** — complète notamment `INV-02/03/07/08`, jusqu'ici tracés implicitement (action **P1-5**,
> [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 ; CTAL-TM Ch.2).

| Invariant  | Énoncé (doc 02 §5)                                            | Test(s) couvrant — `fichier:ligne`                                                                                                                                          |
| ---------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01     | Aucune durée/quantité négative ; toute plage `fin > début`    | `libs/shared-kernel/src/lib/money.mbt.spec.ts` + `duree.mbt.spec.ts` (génération bornée)                                                                                    |
| **INV-02** | `tauxEffort` ∈ barème pour `nbEnfants ≥ 1` (PSU)              | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.spec.ts:21` (cas négatif) + `bareme-effort-psu.mbt.spec.ts:56` (DT-08)                                              |
| **INV-03** | `tranche RFR` ∈ {1,2,3} ; toute grille ABCM existe            | `libs/shared-kernel/src/lib/tranche.mbt.spec.ts` (DT-01) + `tarification/.../abcm/grille-abcm.mbt.spec.ts:81` + `grille-abcm.spec.ts:27` + `referentiel/.../tranche-ref.ts` |
| INV-04     | Jour de fermeture/non-scolaire sans prestation facturable     | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts` (BVA-10 / DT-10)                                                                                           |
| INV-05     | `heuresDeduites(M) ≤ heures réservées contractuelles du mois` | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts` (BVA-08 + propriété)                                                                                         |
| INV-06     | Toute ligne de coût ≥ 0 ; coût mensuel ≥ 0                    | `libs/tarification/domain/src/lib/core/cout-mois.mbt.spec.ts`                                                                                                               |
| **INV-07** | Montants = entiers de centimes en interne                     | `libs/shared-kernel/src/lib/money.spec.ts:33` (refuse centimes non entiers) + `money.mbt.spec.ts` (génération bornée) ; type `MoneyError` (`domain-error.ts:20`)            |
| **INV-08** | Déduction PSU ssi règle 3.2 (préavis 2 j **OU** certificat)   | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts:183` (DT-04, table de vérité préavis×certificat complète) + `tarification/.../psu/tarif-creche-psu.ts:58`     |

> **Vérification** : les 8 invariants sont **déjà couverts** par des tests existants et bloquants ; cette
> action de traçabilité n'a ajouté **aucun test** — elle rend la couverture _auditable par ID_. Les
> invariants sont aussi reliés aux risques métier dans le [registre de risque](19-registre-risque-produit.md)
> §2.1 (RP-01..07).

## 3. Matrice de traçabilité

ID modèle → type → critère de couverture → fichier de test `*.mbt.spec.ts`.

| ID modèle                              | Type                    | Critère de couverture                        | Fichier de test                                                              |
| -------------------------------------- | ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| BVA-01                                 | BVA                     | 3 points / borne                             | `libs/shared-kernel/src/lib/money.mbt.spec.ts`                               |
| BVA-03                                 | BVA                     | 3 points / borne                             | `libs/shared-kernel/src/lib/money.mbt.spec.ts`                               |
| INV-01 (Money)                         | Property                | Génération bornée                            | `libs/shared-kernel/src/lib/money.mbt.spec.ts`                               |
| BVA-02                                 | BVA                     | 3 points / borne                             | `libs/shared-kernel/src/lib/duree.mbt.spec.ts`                               |
| INV-01 (Duree)                         | Property                | Génération bornée                            | `libs/shared-kernel/src/lib/duree.mbt.spec.ts`                               |
| DT-01                                  | Table de décision       | Combinatoire complète                        | `libs/shared-kernel/src/lib/tranche.mbt.spec.ts`                             |
| Monotonie Tranche                      | Property                | Génération bornée                            | `libs/shared-kernel/src/lib/tranche.mbt.spec.ts`                             |
| SM-01                                  | Machine à états         | 0-switch + 1-switch                          | `libs/foyer/domain/src/lib/foyer.mbt.spec.ts`                                |
| DT-02                                  | Table de décision       | Combinatoire complète                        | `libs/foyer/domain/src/lib/foyer.mbt.spec.ts`                                |
| BVA-04                                 | BVA                     | 3 points / borne                             | `libs/foyer/domain/src/lib/foyer.mbt.spec.ts`                                |
| BVA-05                                 | BVA                     | 3 points / borne                             | `libs/foyer/domain/src/lib/foyer.mbt.spec.ts`                                |
| Cohérence tranche / immuabilité / trim | Property                | Génération bornée                            | `libs/foyer/domain/src/lib/foyer.mbt.spec.ts`                                |
| DT-03                                  | Table de décision       | Combinatoire complète                        | `libs/foyer/domain/src/lib/enfant.mbt.spec.ts`                               |
| SM-03                                  | Machine à états         | 0-switch + BVA bornes mensuelles             | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts`               |
| DT-04                                  | Table de décision       | Combinatoire complète (préavis × certificat) | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts`               |
| BVA-08                                 | BVA                     | 3 points / borne (INV-05)                    | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts`               |
| BVA-09                                 | BVA                     | 3 points / borne                             | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts`               |
| INV-05 / monotonie / hors période      | Property                | Génération bornée                            | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts`               |
| DT-05                                  | Table de décision       | Combinatoire complète                        | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts`             |
| BVA-10                                 | BVA                     | 3 points / borne (INV-04)                    | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts`             |
| DT-10                                  | Table de décision       | Combinatoire complète                        | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts`             |
| BVA-11                                 | BVA                     | 3 points / borne                             | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts`             |
| Héritage / INV-04 / monotonie          | Property                | Génération bornée                            | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts`             |
| DT-07                                  | Table de décision       | Combinatoire complète                        | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.mbt.spec.ts`         |
| DT-08                                  | Table de décision       | Combinatoire complète                        | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.mbt.spec.ts`         |
| BVA-17                                 | BVA                     | 3 points / borne                             | `libs/tarification/domain/src/lib/psu/bareme-effort-psu.mbt.spec.ts`         |
| BVA-13..16                             | BVA                     | 3 points / borne                             | `libs/tarification/domain/src/lib/psu/tarif-creche-psu.mbt.spec.ts`          |
| DT-09                                  | Table de décision       | Combinatoire complète (PAI × tranche)        | `libs/tarification/domain/src/lib/abcm/tarif-cantine-abcm.mbt.spec.ts`       |
| (grille T1/T2/T3)                      | Table de décision       | Combinatoire complète                        | `libs/tarification/domain/src/lib/abcm/grille-abcm.mbt.spec.ts`              |
| DT-11                                  | Table de décision       | Combinatoire complète                        | `libs/tarification/domain/src/lib/abcm/frais-fixes-abcm.mbt.spec.ts`         |
| DT-12                                  | Table de décision       | Combinatoire complète                        | `libs/tarification/domain/src/lib/abcm/unites-associatives-abcm.mbt.spec.ts` |
| INV-06                                 | Property                | Génération bornée                            | `libs/tarification/domain/src/lib/core/cout-mois.mbt.spec.ts`                |
| Consolidation = somme                  | Property                | Génération bornée                            | `libs/tarification/domain/src/lib/consolidation/cout-mois-foyer.mbt.spec.ts` |
| SM-SYS                                 | Machine à états système | 0-switch + persistance                       | `apps/web/e2e/planning-mbt.stack.e2e.spec.ts`                                |

> Les libellés « property » d'une même ligne de SUT regroupent plusieurs propriétés
> `fast-check` du fichier (round-trip, monotonie, immuabilité, trim…) ; le tableau renvoie au
> **fichier** qui les porte, conformément au critère par modèle.

## 4. Bilan

- **~260 cas / propriétés MBT ajoutés** sur les 4 libs domaine + 1 modèle système :
  - `shared-kernel` — **70** (money / duree / tranche)
  - `foyer/domain` — **52** (foyer / enfant)
  - `planification/domain` — **97** (contrat-creche 36 + inscription-abcm 61)
  - `tarification/domain` — **102** (PSU + ABCM + core + consolidation)
  - **système** — modèle d'état S0..S4 (E2E stack, `planning-mbt.stack.e2e.spec.ts`).
- **Couverture 100 % maintenue** sur les 4 libs domaine (les seuils `vitest` restent verts ;
  les specs MBT s'ajoutent aux specs existantes sans baisser le seuil).
- **0 bug de production trouvé** : les modèles **confirment la conformité** du code à la
  doc 02 (oracle métier). La valeur est la **traçabilité du critère** et la robustesse des
  invariants (milliers d'entrées générées), pas une correction de défaut.
- **Note méthodologique** : `nx test` **exécute** les specs mais ne **type-check** pas aussi
  strictement que `nx typecheck`. Une spec MBT peut donc « passer » `nx test` tout en ayant
  une erreur de typage : les specs MBT doivent passer **les deux** cibles
  (`nx run-many -t typecheck test`).

> Suite logique de l'audit ISTQB du dépôt (CT-UT, docs 11/12 ; CT-MBT, ce document) : la
> qualité est **outillée et déclarée**, du modèle métier (doc 02) jusqu'au critère de
> couverture vérifié en CI.
