# ADR-0002 — Grain des services & politiques tarifaires multi-modes

- **Statut** : Accepté
- **Date** : 2026-06-02
- **Contexte amont** : [ADR-0001](0001-architecture-microservices.md)

## Contexte

Deux éléments nouveaux après le cadrage initial :

1. Ce lot n'est que le **premier sous-domaine** d'une future **plateforme de budget
   du foyer**.
2. Il doit couvrir **plusieurs modes de garde** aux tarifications hétérogènes :
   crèche **PSU/CNAF** (horaire × taux d'effort, mensualisé) et **ABCM** (périscolaire,
   cantine, ALSH — par tranche RFR — + frais fixes annuels).

## Décision

1. **Élever `Foyer` au rang de service** (`svc-foyer`), owner de la composition et des
   données financières (ressources CNAF, RFR/tranche, nb enfants à charge, parts),
   car c'est le socle partagé de toute la future plateforme budget.
2. **Généraliser le référentiel en `svc-referentiel` (catalogue tarifaire)** versionné,
   hébergeant barème CNAF **et** grilles ABCM **et** calendriers.
3. **`svc-planification`** gère des **activités de garde multi-modes** (pas seulement la
   crèche).
4. **`svc-tarification`** applique une **`PolitiqueTarifaire` par mode** (pattern Stratégie)
   derrière un port unique ; ajouter un mode/prestataire = nouvelle stratégie (OCP).

## Conséquences

- 4 services métier (+ gateway + web) au lieu de 3. Légère hausse de complexité,
  justifiée par l'extensibilité et la réutilisation future.
- Le domaine de calcul reste **fermé à la modification, ouvert à l'extension**.
- `svc-foyer` et `svc-referentiel` deviennent des services transverses de la plateforme.

## Alternatives écartées

- **Garder Foyer dans Planification** : recréerait le besoin de dupliquer les revenus
  dans les futurs domaines budget → rejeté.
- **Un service par prestataire (crèche / ABCM)** : couplerait tarif et structure ;
  préférable de séparer _catalogue_ (données) et _politique_ (calcul).
