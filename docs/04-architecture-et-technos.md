# 04 — Architecture & technologies

> Statut : **À valider** · Version 0.3 · 2026-06-02
> Architecture **microservices** (ADR-0001). Re-grain suite au nouveau contexte
> (multi-modes de garde + plateforme budget à venir) → **ADR-0002**.

## 1. Vision : un sous-domaine d'une plateforme « Budget du foyer »

Ce lot (frais de garde) est le **premier sous-domaine** d'une plateforme de budget
familial plus large (revenus, charges, crédits, projection…). Conséquence de design :

- Le **Foyer** (composition, revenus, RFR, parts) est un **socle partagé** par tous
  les futurs sous-domaines → on l'isole dans son **propre service** dès maintenant.
- Le **catalogue tarifaire** (barèmes/grilles) est une donnée de référence réutilisable.
- Chaque futur domaine (charges, crédits…) viendra comme **nouveau service**, sans
  toucher l'existant. Le découpage actuel doit donc rester ouvert (OCP à l'échelle système).

## 2. Cap architectural (rappel)

Microservices : un déployable par bounded context, **base par service**, communication
**REST/gRPC** (sync) + **événements** (async, NATS JetStream, outbox, idempotence),
**API Gateway/BFF** en entrée, **OpenTelemetry** partout, **Pact** pour les contrats.
Hexagonal + SOLID **à l'intérieur** de chaque service. Détails et standards en doc 03.

## 3. Décomposition en services (re-grain)

```
                          ┌───────────────────────────┐
                          │   Web (React PWA)          │
                          └─────────────┬─────────────┘
                                        │ HTTPS (REST/JSON, OpenAPI)
                          ┌─────────────▼─────────────┐
                          │   API Gateway / BFF        │  agrégation, auth,
                          │   (NestJS)                 │  CORS, rate-limit, /v1
                          └──┬────────┬────────┬───────┘
            REST/gRPC        │        │        │        REST/gRPC
   ┌──────────────────┐  ┌───▼────┐ ┌─▼──────┐ ┌▼─────────────────────┐
   │  svc-foyer       │  │svc-    │ │svc-    │ │  svc-tarification     │
   │  (Household)     │  │referen-│ │planifi-│ │  (Frais de garde)     │
   │                  │  │tiel    │ │cation  │ │                       │
   │ enfants, revenus,│  │(Cata-  │ │(activi-│ │ stratégies par mode : │
   │ RFR+tranche, nb  │  │logue   │ │tés de  │ │ PSU / Péri / Cantine /│
   │ enfants à charge,│  │tarifai-│ │garde)  │ │ ALSH / FraisFixes     │
   │ nb parts         │  │re)     │ │        │ │ → coût mois/an foyer  │
   │ DB: foyer        │  │DB: ref │ │DB:plan │ │ read-model + DB: tarif│
   └────────┬─────────┘  └───┬────┘ └───┬────┘ └──────────┬────────────┘
            │                 │          │                 │
            └─────────────────┴────┬─────┴─────────────────┘
                                   │  Événements (async)
                           ┌───────▼─────────┐
                           │  NATS JetStream  │
                           └──────────────────┘
```

| Service               | Responsabilité (owner des données)                                                                                                                                                                    | Expose                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **svc-foyer**         | Composition du foyer (enfants), données financières : ressources CNAF, **RFR + tranche**, nb enfants à charge, nb parts. _Socle de la plateforme budget._                                             | API foyer/enfants ; événements `FoyerMisAJour`, `EnfantAjouté`.                          |
| **svc-referentiel**   | **Catalogue tarifaire** versionné : barème CNAF (taux d'effort, bornes), grilles ABCM (cantine/péri/ALSH par tranche), frais fixes, **calendriers** (fériés, fermetures crèche, calendrier scolaire). | API « grille applicable à une date/tranche » ; événement `GrillePubliée`.                |
| **svc-planification** | Planning des **activités de garde** par enfant : contrats & semaines types (crèche), inscriptions/réservations péri-cantine-ALSH, planning réel **et simulé**.                                        | CRUD + « prestations consommées du mois » ; événements `ContratCréé`, `PlanningModifié`. |
| **svc-tarification**  | Calcul des **frais de garde** : applique la **politique tarifaire** de chaque mode aux prestations planifiées → coût mensuel/annuel par enfant, par mode, consolidé foyer.                            | API « coût du mois/an » ; consomme les événements des 3 autres.                          |
| **api-gateway / bff** | Point d'entrée unique du front : agrégation multi-services, auth, CORS, rate-limit, versionnage.                                                                                                      | API orientée écran.                                                                      |
| **web**               | PWA React (calendrier, formulaires, vue coûts, simulation).                                                                                                                                           | —                                                                                        |

### Flux de données pour un calcul

`svc-tarification` maintient un **read model** alimenté par événements :

- de **svc-foyer** : tranche RFR, ressources, nb enfants à charge ;
- de **svc-referentiel** : grilles/barèmes applicables ;
- de **svc-planification** : prestations consommées (heures crèche, séances péri,
  repas cantine, jours ALSH).

→ calcul **autonome et résilient** (eventual consistency), avec _fallback_ synchrone
pour un calcul à la demande. Aucun service ne lit la base d'un autre.

## 4. Le cœur extensible : politiques tarifaires (clé du design)

Le nouveau contexte (PSU vs ABCM, radicalement différents) **valide** le choix d'une
**stratégie** par mode de garde derrière un port unique :

```
PolitiqueTarifaire (port)
  calculer(prestations, période, contexteFoyer, grille) : LigneCout[]
  ├─ TarifCrechePSU         # horaire × taux d'effort, mensualisé, complément/minute, déductions
  ├─ TarifPeriscolaireABCM  # séance matin/soir × tranche
  ├─ TarifCantineABCM       # repas × tranche
  ├─ TarifAlshABCM          # journée/½ journée/repas × tranche
  └─ FraisFixesABCM         # cotisation annuelle + frais 1ère inscription
```

Ajouter un mode ou un prestataire = **nouvelle stratégie**, sans modifier le use case
de consolidation (OCP). C'est le seul point d'extension fortement anticipé.

## 5. Stack technique (inchangée vs v0.2)

TypeScript strict · Node LTS · **Nx + pnpm** (frontières vérifiées) · **NestJS**
(microservices, DI) · domaine TS pur · **Zod** · **PostgreSQL** (1 base/service) ·
**Drizzle** + drizzle-kit · **NATS JetStream** · REST+OpenAPI (gRPC interne en option) ·
**Pact** · **React+Vite** (PWA) · Tailwind/shadcn · **FullCalendar** · TanStack Query ·
**OpenTelemetry + pino + Prometheus + Grafana** · **Vitest/Pact/Playwright** ·
**Docker/compose** (k8s en option) · **GitHub Actions** (Nx affected).

## 6. Arborescence (monorepo Nx)

```
creche-planner/                       # (nom à faire évoluer vers "budget-foyer" plus tard)
├─ apps/
│  ├─ api-gateway/
│  ├─ svc-foyer/
│  ├─ svc-referentiel/
│  ├─ svc-planification/
│  ├─ svc-tarification/
│  └─ web/
├─ libs/
│  ├─ shared-kernel/                  # Money, Duree, Tranche, DomainError
│  ├─ contracts/                      # OpenAPI/AsyncAPI + DTO Zod + types d'événements
│  ├─ foyer/{domain,application,infrastructure}/
│  ├─ referentiel/{domain,application,infrastructure}/
│  ├─ planification/{domain,application,infrastructure}/
│  └─ tarification/{domain,application,infrastructure}/   # contient les stratégies
├─ docs/  (+ docs/adr/)
├─ docker-compose.yml                 # 4 services + gateway + 4 Postgres + NATS + Prometheus/Grafana
└─ k8s/                               # (option)
```

Frontières Nx : un service n'importe jamais le `domain`/`infrastructure` d'un autre ;
la seule dépendance inter-contextes autorisée est `libs/contracts` (API/événements).

## 7. Chemin d'évolution vers la plateforme budget

- Nouveau sous-domaine (charges, crédits, projection) = **nouveau `svc-*`** consommant
  les événements `svc-foyer`.
- `svc-foyer` et `svc-referentiel` deviennent les **services de référence** transverses.
- Le BFF s'enrichit d'écrans budget sans impacter les services de garde.
