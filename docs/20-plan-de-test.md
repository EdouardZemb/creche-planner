# 20 — Plan de test par phase

> Statut : **Établi** · Version 1.0 · 2026-06-07
> Plan de test **léger** qui rend explicites les **critères d'entrée** (jusqu'ici absents) et relie les
> **critères de sortie aux KPI** ([doc 21](21-politique-strategie-test.md) §1.3). Capitalise sur les
> **DoD** ([doc 03](03-standards-developpement.md) §9) et les **jalons** M1→M9
> ([doc 05](05-plan-de-developpement.md) §Jalons) plutôt que de repartir de zéro. Donne suite à
> l'action **P1-1** ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 ; CTAL-TM Ch.1, PA TMMi 2.2).

---

## 1. Gabarit (à réutiliser pour toute phase future)

Chaque phase déclare :

- **Items testés** — quelles unités/parcours sont sous test.
- **Niveaux mobilisés** — parmi ceux de la [stratégie](21-politique-strategie-test.md) §2.
- **Critères d'ENTRÉE** — ce qui doit être vrai pour commencer à tester (souvent : phase amont verte +
  environnement disponible + oracle défini).
- **Critères de SORTIE** — reliés aux KPI : _quels gates verts_ et _quelle valeur de KPI_ closent la phase.
- **Environnement** — où ça tourne.
- **Risques** — renvoi au [registre de risque](19-registre-risque-produit.md).

> **Critère d'entrée standard** (toute phase) : `main` verte (CI au vert sur la base), lockfile gelé
> installé (`pnpm install --frozen-lockfile`), et — pour les phases d'intégration — pile dockerisée
> démarrable (`docker compose up --wait`) + seed `--verify` au vert.
>
> **Critère de sortie standard** (toute phase) : `pnpm nx affected -t lint typecheck test build` vert ;
> DoD doc 03 §9 satisfaite ; doc mise à jour si une règle métier a changé.

---

## 2. Plan par phase (phases livrées)

| Phase / jalon                    | Items testés                                           | Niveaux mobilisés                          | Critères d'ENTRÉE (spécifiques)            | Critères de SORTIE reliés aux KPI                                           | Risques couverts    |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------- | ------------------- |
| **P0-1 Socle / plomberie** (M1)  | bootstrap services, trace id, `/health`                | Unitaire, Smoke                            | Cadrage figé (doc 01/04)                   | CI verte ; chaque service répond `/health` ; trace distribuée visible       | RT-06               |
| **P2 Domaine tarifaire** (M2)    | calcul PSU/ABCM, `CT-01..20`, `INV-01..08`             | Unitaire domaine (TDD), MBT                | Oracle doc 02 figé (montants réels)        | **Couverture domaine = 100 %** (thresholds) ; tous `CT-xx` verts            | RP-01..07           |
| **P3 svc-foyer** (M2)            | foyer, tranche RFR (INV-03), DTO Zod                   | Unitaire, Contrat de port, Intégration SQL | Domaine tarifaire vert ; Postgres éphémère | 100 % domaine foyer ; repo mémoire **ET** SQL passent la même suite (LSP)   | RP-02, RT-08        |
| **P4 svc-referentiel** (M2)      | grilles/barèmes versionnés                             | Unitaire, Intégration SQL                  | idem P3                                    | grilles ABCM complètes pour T1/T2/T3 (INV-03)                               | RP-02               |
| **P5 svc-planification** (M2-M3) | contrat crèche, inscription ABCM, garde de période     | Unitaire, MBT, Intégration                 | Domaine + référentiel verts                | 100 % domaine ; DT-04/INV-04/05 verts                                       | RP-03, RP-04, RP-05 |
| **P6 svc-tarification** (M3)     | projection NATS, consolidation, repli synchrone        | Unitaire, Intégration, Contrat             | Outbox/idempotence en place ; NATS dispo   | coût consolidé via chemin distribué (événements) ; consolidation = somme    | RP-07, RT-01        |
| **P7 API Gateway / BFF** (M4)    | routes `/api/v1`, agrégation, timeouts/repli           | Contrat (Pact consumer), Intégration       | Services aval verts ; pacts définis        | **Pact bloquant vert** + `can-i-deploy` ; API de bout en bout               | RT-02, RT-04, RT-05 |
| **P8 Web** (M5)                  | calendrier, panneau coût, vue annuelle, simulation     | Composant, E2E web mocké                   | BFF vert ; routes stables                  | E2E web vert ; parcours « planifier → lire le coût » ok                     | RT-03               |
| **P9 Durcissement** (M6)         | résilience, observabilité, déploiement                 | Intégration, Smoke stack                   | Pile complète démarrable                   | `smoke-stack` vert (boot + appel fonctionnel) ; résilience vérifiée         | RT-01, RT-06        |
| **P10 Front fiable** (M7)        | navigation, focus de route, erreurs actionnables       | Composant, E2E                             | Web vert                                   | aucune impasse de navigation ; erreurs actionnables                         | RT-03               |
| **P11 Découplage** (M8)          | contrats par contexte, versioning, release par service | Contrat (Pact), CI affected                | Pacts par paire définis                    | `pact-can-i-deploy` vert ; build/test/déploiement par service (Nx affected) | RT-02               |
| **P12 Accessibilité** (M9)       | onglets, focus, erreurs (WCAG 2.1 AA)                  | a11y (axe-core), E2E                       | Front fiable vert ; app servie             | **0 violation axe** sur toutes les routes                                   | —                   |
| **P15 E2E stack réelle**         | parcours contre la pile réelle (anti-régression)       | E2E stack réelle, Smoke stack              | Pile dockerisée + seed `--verify` verts    | `smoke-stack` + `e2e-stack` verts ; **0 régression d'intégration**          | RT-01, RT-03        |
| **MBT (CT-MBT)**                 | modèles domaine + système (machines d'états, BVA, DT)  | MBT (`fast-check`, `it.each`)              | Domaine 100 % couvert                      | 100 % maintenu ; **flakiness ≈ 0** ; matrice de traçabilité doc 17 complète | RP-01..07, RQ-01    |

> **Note** — les phases sont issues du plan de **développement** ([doc 05](05-plan-de-developpement.md)) ;
> ce plan de **test** y projette les niveaux, critères et risques. Les montants/oracles sont figés par
> [doc 02](02-modele-de-cout.md) ; l'état d'avancement réel est suivi dans
> [doc 06](06-etat-davancement.md).

---

## 3. Environnements de test

| Environnement         | Usage                               | Provisionnement                                               |
| --------------------- | ----------------------------------- | ------------------------------------------------------------- |
| **Local in-memory**   | unitaire domaine, composant, MBT    | aucun (TypeScript pur, jsdom)                                 |
| **Postgres éphémère** | intégration SQL, Pact provider      | services CI (`ci.yml`) / `docker compose` local               |
| **Pile dockerisée**   | E2E stack réelle, smoke, a11y, perf | `docker compose up --wait` + `scripts/seed-demo.mjs --verify` |

---

## 4. Liens

- Politique & KPI : [doc 21](21-politique-strategie-test.md) §1
- Stratégie par niveau : [doc 21](21-politique-strategie-test.md) §2
- Registre de risque : [doc 19](19-registre-risque-produit.md)
- Traçabilité invariants → test : [doc 17](17-tests-model-based-ct-mbt.md) §2-3
- DoD & standards : [doc 03](03-standards-developpement.md) §6-9
