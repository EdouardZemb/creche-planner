# 19 — Registre de risque produit

> Statut : **Établi** · Version 1.0 · 2026-06-07
> Consolide en un **registre coté** (probabilité × impact → niveau → tests d'atténuation) les tables
> de risque jusqu'ici **éparses et non cotées** : [doc 05](05-plan-de-developpement.md) §« Risques
> microservices », [doc 15](15-spec-tests-e2e-stack-reelle.md) §8, et les risques techniques portés
> implicitement par les invariants `INV-01..08` ([doc 02](02-modele-de-cout.md) §5). Donne suite à
> l'action **P1-4** ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 ; CTAL-TM Ch.2, PA TMMi 2.2).

---

## 1. Méthode de cotation

**Niveau de risque = Probabilité × Impact**, sur une échelle à 3 crans chacune :

| Échelle         | 1 — Faible               | 2 — Moyen                                   | 3 — Élevé                                   |
| --------------- | ------------------------ | ------------------------------------------- | ------------------------------------------- |
| **Probabilité** | improbable en pratique   | plausible sous certaines conditions         | déjà observé ou structurellement probable   |
| **Impact**      | gêne mineure, réversible | montant faux corrigeable / parcours dégradé | **montant faux restitué** ou parcours cassé |

**Niveau** = score P×I → 🟥 **Critique** (6-9) · 🟧 **Élevé** (4) · 🟨 **Moyen** (2-3) · 🟩 **Faible** (1).

L'effort de test est **priorisé par le niveau** : tout risque 🟥/🟧 doit avoir au moins un test
d'atténuation **bloquant en CI**. Le registre est la base du **risk-based testing** de la
[stratégie de test](21-politique-strategie-test.md) §2.2.

---

## 2. Registre

### 2.1 Risques métier (exactitude du coût)

Matérialisés par les invariants `INV-01..08`. Un défaut ici **restitue un montant faux** → impact 3.

| ID    | Risque                                                        |  P  |  I  | Niveau | Tests d'atténuation (bloquants CI)                                                             |
| ----- | ------------------------------------------------------------- | :-: | :-: | :----: | ---------------------------------------------------------------------------------------------- |
| RP-01 | Tarif/mensualité PSU faux (taux d'effort, arrondi)            |  2  |  3  |  🟥 6  | `libs/tarification/domain/.../psu/*.spec.ts` + `*.mbt.spec.ts` (CT-01..08) ; INV-02/07         |
| RP-02 | Grille ABCM fausse ou absente pour une tranche (INV-03)       |  2  |  3  |  🟥 6  | `libs/tarification/domain/src/lib/abcm/grille-abcm.{spec,mbt.spec}.ts` ; `tranche.mbt.spec.ts` |
| RP-03 | Déduction d'absence accordée à tort / refusée à tort (INV-08) |  2  |  3  |  🟥 6  | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts` (DT-04, préavis×certificat)     |
| RP-04 | Jour non facturable compté en prestation (INV-04)             |  2  |  3  |  🟥 6  | `libs/planification/domain/src/lib/inscription-abcm.mbt.spec.ts` (BVA-10/DT-10)                |
| RP-05 | Sur-déduction au-delà des heures réservées (INV-05)           |  1  |  3  |  🟨 3  | `libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts` (BVA-08)                        |
| RP-06 | Coût négatif / arrondi monétaire faux (INV-06/07/01)          |  1  |  3  |  🟨 3  | `libs/shared-kernel/src/lib/money.{spec,mbt.spec}.ts` ; `.../core/cout-mois.mbt.spec.ts`       |
| RP-07 | Consolidation foyer ≠ somme des coûts (cohérence annuelle)    |  1  |  3  |  🟨 3  | `libs/tarification/domain/src/lib/consolidation/cout-mois-foyer.mbt.spec.ts`                   |

### 2.2 Risques techniques (architecture distribuée)

| ID    | Risque                                                               |  P  |  I  | Niveau | Tests / parades d'atténuation                                                                                              |
| ----- | -------------------------------------------------------------------- | :-: | :-: | :----: | -------------------------------------------------------------------------------------------------------------------------- |
| RT-01 | **Eventual consistency NATS** : read model froid → coût absent/repli |  3  |  2  |  🟥 6  | Outbox transactionnel + consommateurs idempotents ; E2E stack `expect.poll` sur `/couts` ; repli synchrone ADR-0004        |
| RT-02 | **Dérive de contrats** gateway ↔ services (rupture silencieuse)      |  2  |  3  |  🟥 6  | Pact consumer+provider **bloquant** + `pact-can-i-deploy` (`.github/workflows/ci.yml`)                                     |
| RT-03 | **Régression d'intégration** invisible en E2E mocké (cf. doc 14)     |  2  |  3  |  🟥 6  | E2E **stack réelle** `*.stack.e2e.spec.ts` (`smoke-stack` + `e2e-stack`) ; règle d'équipe doc 03 §6                        |
| RT-04 | **Atomicité du rate-limit** (429) sous concurrence                   |  2  |  2  |  🟧 4  | `apps/api-gateway/src/security/rate-limit.guard.spec.ts` ; isolation E2E (`docker-compose.yml:259-262`)                    |
| RT-05 | **Latence `/couts/annuel`** dépasse le budget de repli 502           |  2  |  2  |  🟧 4  | Parallélisation + single-flight (doc 06 §19.7, ~0,93 s) ; **smoke perf** SLO p95 ([doc 23](23-smoke-performance.md), P2-6) |
| RT-06 | **Crash au boot** d'un service (dépendance non embarquée)            |  2  |  2  |  🟧 4  | `smoke-stack` (`docker compose up --build --wait` + appel fonctionnel) ; lockfile gelé                                     |
| RT-07 | **Vulnérabilité de dépendance** (gateway HTTP publique)              |  2  |  3  |  🟥 6  | `pnpm audit --audit-level=high` bloquant + Dependabot + CodeQL ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) P1-6)     |
| RT-08 | **Régression de frontières** hexagonales (couplage interdit)         |  2  |  2  |  🟧 4  | ESLint `@nx/enforce-module-boundaries` bloquant + tests de pureté (`libs/shared-kernel/.../purete.guard.spec.ts`)          |
| RT-09 | **Dérive d'environnement** (image `latest` non reproductible)        |  2  |  2  |  🟧 4  | Postgres/NATS épinglés ; images d'observabilité épinglées (P2-8) ; CI `--frozen-lockfile`                                  |

### 2.3 Risques de processus / qualité des tests

| ID    | Risque                                                        |  P  |  I  | Niveau | Parade d'atténuation                                                                          |
| ----- | ------------------------------------------------------------- | :-: | :-: | :----: | --------------------------------------------------------------------------------------------- |
| RQ-01 | **Flakiness E2E** (eventual consistency, démarrage de pile)   |  2  |  2  |  🟧 4  | `--wait` healthchecks, `expect.poll`, `retries: 1` ; flakiness suivie en KPI (JUnit CI, P1-2) |
| RQ-02 | **Jeu de données mono-foyer** (angle mort T1/T2, multi-modes) |  2  |  2  |  🟧 4  | MBT à génération bornée couvre les tranches ; diversification jeux de données en suivi (P3-4) |
| RQ-03 | **Bus factor = 1** (pas de relecteur humain indépendant)      |  2  |  2  |  🟧 4  | Revue assistée IA tracée en PR (P2-9) + gates CI + hooks ; documenté N/A organisationnel      |
| RQ-04 | **Observabilité inerte** : seuils/alertes non déclenchables   |  3  |  1  |  🟨 3  | Câblage pipeline OTel→Prometheus + Alertmanager (P2-3) ; sans risque métier tant qu'inerte    |

---

## 3. Synthèse & pilotage

- **7 risques 🟥 Critiques** — tous couverts par au moins un test **bloquant en CI** (objectif de la
  politique §1.2). Les risques métier 🟥 (RP-01..04) sont en outre **tracés par invariant** vers leurs
  tests dans [doc 17](17-tests-model-based-ct-mbt.md) §2.
- **Risques résiduels assumés** : RQ-02 (mono-foyer) et RT-09 (épinglage observabilité) sont traités
  partiellement ; le reste est en suivi P3 ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8).
- **Revue** : ce registre est relu à chaque phase via le [plan de test](20-plan-de-test.md) (section
  « risques » de chaque phase) et mis à jour à toute fuite consignée au
  [registre d'anomalies](22-registre-anomalies.md).
