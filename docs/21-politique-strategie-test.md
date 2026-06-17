# 21 — Politique & stratégie de test

> Statut : **Établi** · Version 1.0 · 2026-06-07
> Promeut en artefacts **nommés et gouvernés** la politique et la stratégie de test
> jusqu'ici **implicites** (encapsulées dans [doc 03](03-standards-developpement.md) §6,
> [doc 15](15-spec-tests-e2e-stack-reelle.md) §4, les DoD et la CI). Donne suite aux actions
> **P2-1** (politique) et **P2-2** (stratégie) de la feuille de route d'audit
> [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 (PA TMMi 2.1, CTAL-TM Ch.1).

---

## 1. Politique de test (P2-1)

### 1.1 Objectifs qualité

La qualité protège **la capacité à reprendre le projet dans 6 mois** et **l'exactitude des montants
restitués** (un coût faux est pire qu'absent — décision financière réelle d'une famille). Par ordre
de priorité :

1. **Exactitude du domaine de coût.** Tout montant restitué est conforme à l'oracle métier
   ([doc 02](02-modele-de-cout.md), cas `CT-01..20`) et aux invariants `INV-01..08` (doc 02 §5).
2. **Non-régression d'intégration.** Un parcours utilisateur qui a fonctionné continue de fonctionner
   contre la **pile réelle** (pas seulement mocké) — règle E2E stack réelle (doc 03 §6, doc 15).
3. **Compatibilité des contrats inter-services.** Aucune dérive silencieuse gateway ↔ services
   (Pact bloquant + `can-i-deploy`).
4. **Reprenabilité.** Le test documente l'intention métier : un test vert est un oracle lisible.

### 1.2 Principes

- **Tout comportement métier est couvert par un test avant d'être considéré fait** (doc 03 §1.5, DoD
  doc 03 §9).
- **La couverture est un garde-fou, pas un but** : 100 % exigé sur les libs `domain`, pas de test
  « pour la métrique » (doc 03 §6).
- **La CI est l'autorité** : `main` ne reçoit que du vert ; les gates sont bloquants (lint, typecheck,
  test, build, Pact, smoke-stack, e2e-stack — `.github/workflows/ci.yml`).
- **L'amélioration est pilotée par l'incident et par le modèle** : chaque fuite en usage réel produit
  une action de processus (règle E2E stack née de doc 14 ; filiation d'audits CT-UT → CT-MBT).

### 1.3 KPI suivis

Trois KPI **réellement disponibles** sont retenus (les autres restent en P3, faute d'historisation) :

| KPI                               | Définition                                                          | Source                                                                                            | Cible / état                                      |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Couverture domaine**            | statements/branches/functions/lines des libs `domain`               | `libs/*/domain/vitest.config.mts` (thresholds bloquants) + artefacts CI lcov                      | **100 %** (enforced)                              |
| **Défauts trouvés en usage réel** | bugs révélés par E2E stack réelle / validation manuelle, par niveau | [registre d'anomalies](22-registre-anomalies.md)                                                  | tendance ↓ ; tout défaut → test de non-régression |
| **Flakiness E2E**                 | re-runs Playwright (`retries: 1`) avant succès                      | rapports JUnit Playwright en artefacts CI ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) P1-2) | ≈ 0 ; toute instabilité tracée                    |

> Les KPI **défauts en usage réel** et **flakiness** deviennent mesurables grâce à la publication des
> métriques de test en CI (action P1-2) et au [registre d'anomalies](22-registre-anomalies.md) (P2-5).

### 1.4 Contexte & responsabilités

Projet **personnel, mono-développeur, assisté par IA**, sans équipe de test indépendante (doc 03 §0).
Les rôles « groupe de test », « plan de formation », « gestion des compétences » sont **N/A** ; ils
sont **compensés** par : automatisation exhaustive (Nx affected), gates CI bloquants, revue assistée
par IA tracée dans la PR (`.github/pull_request_template.md`), hooks husky (lint-staged + commitlint).

---

## 2. Stratégie de test (P2-2)

Stratégie **par niveau** : pour chaque niveau, l'**objectif**, le **déclencheur** (quand on l'écrit),
l'**oracle** (qui dit vrai), le **critère de couverture** et la **porte CI**.

| Niveau                    | Objectif                                       | Déclencheur                                          | Oracle                                                         | Critère de couverture                                           | Porte CI (`ci.yml`)                                            |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| **Unitaire domaine**      | Exactitude des règles de coût pures            | TDD — cas `CT-xx` écrits **avant** le code           | [doc 02](02-modele-de-cout.md) (montants réels) + `INV-01..08` | **100 %** (thresholds vitest) + 3 points/borne (BVA)            | `ci` (test, bloquant)                                          |
| **MBT (model-based)**     | Robustesse des invariants sur entrées générées | Tout modèle métier (machine d'états, table décision) | Modèle + invariant (`fast-check`)                              | 0-switch + 1-switch ; combinatoire complète ; génération bornée | `ci` (test) + matrice [doc 17](17-tests-model-based-ct-mbt.md) |
| **Composant (web)**       | Rendu & interactions isolées                   | Tout composant React à logique                       | Testing Library (rôles/labels accessibles)                     | Chemins de rendu critiques                                      | `ci` (test)                                                    |
| **Intégration / adapter** | Conformité des adapters aux ports (LSP)        | Tout nouvel adapter (repo SQL…)                      | Suite de contrat de port partagée (mémoire ET SQL)             | Tous les ports                                                  | `ci` (test, Postgres éphémères)                                |
| **Contrat (Pact)**        | Compatibilité gateway ↔ services               | Toute interaction inter-services modifiée            | Pact consumer (attentes) vérifié côté provider réel + Postgres | Toutes les paires consommateur/fournisseur                      | `ci` (provider) + `pact-can-i-deploy`                          |
| **E2E web mocké**         | Feedback rapide de parcours UI (offline)       | Tout parcours UI                                     | `page.route` (BFF mocké)                                       | Parcours critiques                                              | `e2e-web`                                                      |
| **E2E stack réelle**      | Anti-régression d'intégration de bout en bout  | **Toute évolution touchant un parcours utilisateur** | Pile dockerisée réelle (aucun mock réseau) + seed `--verify`   | Parcours critiques contre services réels                        | `smoke-stack` + `e2e-stack`                                    |
| **Accessibilité (a11y)**  | Conformité WCAG 2.1 AA                         | Toute route servie                                   | `@axe-core/playwright` (0 violation)                           | Toutes les routes                                               | `e2e-stack` (axe)                                              |
| **Performance (smoke)**   | Tenue du SLO p95 sur l'agrégation annuelle     | Modif du chemin `/couts/annuel`                      | SLO p95 documenté ([doc 23](23-smoke-performance.md))          | Route `/api/v1/couts/annuel`                                    | `perf-smoke` (cf. P2-6)                                        |
| **Sécurité (SCA)**        | Pas de vulnérabilité connue haute/critique     | Toute modif de dépendances                           | `pnpm audit --audit-level=high` + Dependabot + CodeQL          | Arbre de dépendances + code applicatif                          | `security` (cf. P1-6)                                          |
| **Mutation (Stryker)**    | Prouver que les assertions **mordent**         | Hebdo + manuel (jamais en porte de PR)               | Mutants tués par la suite vitest (§2.4)                        | Score ≥ 80 % par lib domaine (seuil `break`)                    | `mutation.yml` (hors CI bloquante, cf. AQ-13)                  |

### 2.1 Forme de la pyramide

Base **unitaire domaine** dominante (100 % couvert + ~260 cas/propriétés MBT), étage **contrat**
intermédiaire (Pact bidirectionnel), sommet **E2E** fin et ciblé (mocké pour le feedback, **stack
réelle** pour l'intégration). Pas d'inversion de pyramide (cf. [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) E.7).

### 2.2 Tests basés sur le risque

L'effort de test est **priorisé par le risque produit** : voir le
[registre de risque produit](19-registre-risque-produit.md) (probabilité × impact → niveau → tests
d'atténuation). Les invariants `INV-01..08` matérialisent les risques métier de classe ; ils sont
tracés vers leurs tests dans [doc 17](17-tests-model-based-ct-mbt.md) §2-3.

### 2.3 Environnements & données

Environnements **versionnés et éphémères** (`docker-compose.yml` + Postgres CI), seed **idempotent**
avec oracle `--verify` (`scripts/seed-demo.mjs`), teardown systématique (`down -v`). Détail :
[doc 15](15-spec-tests-e2e-stack-reelle.md) et [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) axe E.

### 2.4 Mutation testing (AQ-13)

La couverture à 100 % des libs domaine ne prouve pas que les assertions **mordent** : Stryker
mesure la part des mutants (altérations délibérées du code) que la suite tue effectivement.

**Cible reproductible.** `pnpm nx run <lib>:mutation` sur `tarification-domain` et
`planification-domain` (cible `mutation` déclarée dans le `package.json` de chaque lib,
`dependsOn ^build`, jamais mise en cache). Config : `libs/*/domain/stryker.config.mjs`
(`@stryker-mutator/core` + `vitest-runner` ; le plugin est déclaré **explicitement** car pnpm
n'hoiste pas dans les libs et le glob par défaut ne scanne que le `node_modules` local).
Rapports HTML/JSON dans `test-output/stryker/` (gitignoré).

**Porte.** Hors CI bloquante (coûteux : ~3-6 min/lib) : workflow `mutation.yml` hebdomadaire
(lundi 05:00 UTC) + `workflow_dispatch`, rapports en artefacts 90 j. Le seuil `break: 80` met le
run hebdo en échec sous 80 % — signal à trier, aucune PR bloquée.

**Référence (2026-06-12, session H).** Avant triage : tarification 86,94 %, planification
86,73 % (les deux > 80 % du premier coup). Après renforcement des tests :
**tarification 99,55 %** (l'unique survivant est un mutant **équivalent** : le repli `?? []`
des absences muté en tableau parasite est neutralisé par le filtre `estDeductible`) ;
**planification 88,37 %** (57 survivants restants inventoriés dans la PR de la session H — majoritairement
libellés/messages et branches d'agrégation de `planning-simule.ts`). Trous réels révélés et
corrigés : borne INV-08 (préavis = 2 j pile jamais testé), `estVide()` jamais asserté à faux,
bornes du contrat crèche (contrat d'un seul jour, ancres regex des dates ISO, 0 h annuelle,
1 mensualité), libellés des lignes de coût (contrat d'affichage du détail restitué à l'UI).

**Leçon de triage.** Asserter le **message** d'erreur, pas seulement la classe : un mutant qui
fait tomber l'entrée invalide dans un AUTRE contrôle levant la même classe survit à un simple
`toThrow(Classe)` (vu sur l'ancre `^` du format de date : l'entrée préfixée passait le format
muté puis échouait sur l'ordre de période, même classe d'erreur).

---

## 3. Gouvernance documentaire

| Artefact                      | Document                                      | Action d'audit |
| ----------------------------- | --------------------------------------------- | -------------- |
| Politique de test             | ce document §1                                | P2-1           |
| Stratégie de test             | ce document §2                                | P2-2           |
| Plan de test par phase        | [doc 20](20-plan-de-test.md)                  | P1-1           |
| Registre de risque produit    | [doc 19](19-registre-risque-produit.md)       | P1-4           |
| Registre d'anomalies          | [doc 22](22-registre-anomalies.md)            | P2-5           |
| Traçabilité invariants → test | [doc 17](17-tests-model-based-ct-mbt.md) §2-3 | P1-5           |
| Standards de test             | [doc 03](03-standards-developpement.md) §6-8  | —              |

Ces artefacts visent à faire passer la gouvernance de test de **implicite** à **nommée et auditable**
(cible : Niveau 2 TMMi complet, cf. [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §7).
