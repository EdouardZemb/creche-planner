# 18 — Audit de la gestion des tests (ISTQB CTAL-TM v3.0) & maturité d'industrialisation (TMMi)

> **Type** : rapport d'audit (lecture seule). Aucun code ni artefact n'a été modifié par cet
> exercice — le livrable est ce document.
> **Date** : 2026-06-07.
> **Référentiels** : ISTQB **Certified Tester Advanced Level – Test Management v3.0** (CTAL-TM, 2023)
> et **TMMi** (Test Maturity Model integration).
> **Méthode** : audit multi-agent (6 axes en parallèle, chacun fondé sur des preuves `fichier:ligne`),
> puis synthèse centralisée. Chaque constat est traçable jusqu'au dépôt.

---

## 1. Objet & périmètre

Évaluer le projet `creche-planner` sous deux angles complémentaires :

- **CTAL-TM v3.0** — l'alignement des **pratiques de gestion des tests** avec les objectifs
  d'apprentissage du syllabus (gérer les activités de test, le risque produit, les anomalies,
  l'amélioration du processus, les outils).
- **TMMi** — le **niveau de maturité d'industrialisation** des tests, évalué _process area_ par
  _process area_ (PA), avec un verdict de niveau global.

**Contexte déterminant pour la notation** : projet **personnel, mono-développeur, assisté par IA,
sans équipe de test humaine dédiée** (déclaré `docs/03-standards-developpement.md:5`). Plusieurs PA
TMMi présupposent une organisation pluripersonnelle (groupe de test indépendant, plan de formation,
gestion des compétences) ; elles sont marquées **N/A** et **ne pèsent pas** comme des lacunes. Les
notations jugent la **substance** des pratiques, pas la conformité formelle à un référentiel pensé
pour des organisations.

---

## 2. Échelles de notation

**TMMi — échelle NPLF** (atteinte des buts d'une PA) :

| Code    | Signification                                               |
| ------- | ----------------------------------------------------------- |
| **N**   | _Not Achieved_ — quasi absent                               |
| **P**   | _Partially Achieved_ — éléments présents, non systématiques |
| **L**   | _Largely Achieved_ — atteint avec faiblesses mineures       |
| **F**   | _Fully Achieved_ — pleinement atteint                       |
| **N/A** | Sans objet dans le contexte                                 |

> Règle TMMi de franchissement de niveau : un niveau est atteint quand **toutes** ses PA sont au
> moins **Largely** _(L)_. Une seule PA en _P_ bloque le niveau.

**CTAL-TM — échelle de maturité de pratique** : **Absent → Émergent → Établi → Optimisé**.

---

## 3. Synthèse exécutive

### 3.1 Verdict global

Le projet présente un **profil de maturité très hétérogène**, caractéristique d'un produit
**mûr en ingénierie de test mais peu formalisé en gouvernance de test** :

- **Exécution des tests : excellence (niveau L2 _Fully_, débordant sur des pratiques L3/L4).**
  Pyramide de tests saine et outillée, techniques de conception formelles (BVA, tables de décision,
  transition d'états, **property-based**), tests de **contrat Pact** bidirectionnels et bloquants,
  **MBT** avec critères de couverture déclarés, environnements versionnés (docker + Postgres
  éphémères CI alignés), **données de test maîtrisées** (seed idempotent avec oracle `--verify`),
  CI reproductible et bloquante (`affected`, smoke-stack, E2E stack réelle).

- **Gouvernance des tests : émergente.** La **politique**, la **stratégie** et la **planification**
  de test n'existent que de façon **implicite**, encapsulées dans les standards de dev (`docs/03`),
  le plan de **développement** (`docs/05`) et les DoD/CI — jamais sous forme d'artefacts de test
  **nommés et gouvernés**. Pas de **registre de risque produit** coté, pas de **gestion d'anomalies**
  outillée/mesurée, pas de **reporting de métriques** historisé, pas de tests **de sécurité / de
  performance** en régression.

### 3.2 Niveau TMMi atteint

> **Niveau formel : 1 (Initial).** Le niveau 2 n'est **pas** pleinement satisfait : les PA
> _Test Policy & Strategy_ (2.1) et _Test Planning_ (2.2) sont en **Partially**, ce qui bloque
> le franchissement — alors même que _Test Design & Execution_ (2.4) et _Test Environment_ (2.5)
> sont **Fully** et que certaines pratiques touchent les niveaux 3 à 5.

Ce verdict n'est **pas** un jugement de faible qualité : c'est un **décalage de formalisation**.
Le socle technique d'un niveau 2 (voire 3) est là ; il manque la **couche documentaire de gestion**
(politique, stratégie, plan, mesure) pour le rendre **auditable** et franchir formellement le palier.

**Cible réaliste : consolider un Niveau 2 complet** (puis viser des éléments de Niveau 3) avec un
effort essentiellement **documentaire** — la matière première existe déjà, dispersée dans `docs/06`.

---

## 4. Carte de maturité TMMi (par process area)

| Niveau             | Process Area                     |  Note   | Justification courte                                                                             |
| ------------------ | -------------------------------- | :-----: | ------------------------------------------------------------------------------------------------ |
| **2 Managed**      | 2.1 Test Policy & Strategy       |  **P**  | Stratégie réelle (L) mais non nommée ; politique implicite, KPI limités à la couverture          |
|                    | 2.2 Test Planning                |  **P**  | Pas de plan de test ; critères d'entrée absents, sortie sous étiquette DoD ; estimation absente  |
|                    | 2.3 Test Monitoring & Control    |  **L**  | Gates CI bloquants solides ; mais mesure/reporting/tendances quasi absents                       |
|                    | 2.4 Test Design & Execution      |  **F**  | Techniques formelles + MBT + Pact, exécution CI reproductible et tracée                          |
|                    | 2.5 Test Environment             |  **F**  | docker/CI éphémères alignés, seed idempotent + oracle, isolation des cas                         |
| **3 Defined**      | 3.1 Test Organization            | **N/A** | Contexte solo IA-assisté — sans objet                                                            |
|                    | 3.2 Test Training Program        | **N/A** | Idem                                                                                             |
|                    | 3.3 Test Lifecycle & Integration | **P/L** | Intégré au plan de dev par phases/DoD ; pas de cycle de test dédié formalisé                     |
|                    | 3.4 Non-functional Testing       |  **P**  | a11y systématique (axe WCAG) ; perf/résilience ad hoc ; sécurité applicative quasi absente       |
|                    | 3.5 Peer Reviews                 |  **L**  | Processus défini & outillé (PR template, hooks, gates) ; pas de relecteur humain indépendant     |
| **4 Measured**     | 4.1 Test Measurement             |  **N**  | Aucune métrique de test historisée/reportée hors couverture                                      |
|                    | 4.2 Product Quality Evaluation   |  **N**  | Pipeline métriques OTel→Prometheus non câblé → seuils/alertes inertes                            |
|                    | 4.3 Advanced Reviews             |  **N**  | Pas de revue pilotée par les données                                                             |
| **5 Optimization** | 5.1 Defect Prevention            |  **P**  | Non-régression systématique + garde-fous de classe, mais sans mesure ni analyse causale formelle |
|                    | 5.2 Quality Control              |  **N**  | Pas de contrôle statistique de la qualité                                                        |
|                    | 5.3 Test Process Optimization    |  **P**  | Amélioration réelle et pilotée par modèle (CT-UT→CT-MBT), mais informelle, non mesurée           |

**Lecture** : un **niveau 2 « presque acquis »** (3 PA sur 5 à L/F, les 2 PA de gouvernance à P),
des **îlots de niveau 3** (Peer Reviews L, a11y), et des **amorces authentiques de niveau 5**
(prévention par garde-fous, amélioration pilotée par modèle) — mais tout le **niveau 4 (mesure)**
manque, ce qui plafonne structurellement la progression.

---

## 5. Alignement CTAL-TM v3.0 (par chapitre)

| Chapitre CTAL-TM v3.0                        |         Maturité          | Constat de synthèse                                                                                               |
| -------------------------------------------- | :-----------------------: | ----------------------------------------------------------------------------------------------------------------- |
| **1. Managing the Test Activities**          | **Établi** (avec lacunes) | Stratégie & contrôle solides ; **planification formelle**, **critères d'entrée** et **estimation** manquants      |
| **2. Managing Product Risk**                 |       **Émergent**        | Robustesse _de facto_ forte, mais **aucun registre de risque coté** ni priorisation des tests par risque          |
| **3. Defect Management**                     |       **Émergent**        | Consignation narrative riche, mais **aucun processus/outil/métrique** d'anomalie (ni DDP, ni densité)             |
| **4. Managing the Test Process Improvement** |        **Établi**         | Amélioration réelle, **pilotée par modèle** (filiation ISTQB CT-UT → CT-MBT) ; non systématisée/mesurée           |
| **5. Test Tools and Automation**             |   **Établi → Optimisé**   | Sélection/architecture d'outils exemplaire (Nx affected, Pact, fast-check, Playwright, axe) ; **ROI non chiffré** |
| **6. People skills / stakeholders**          |          **N/A**          | Contexte solo — sans objet                                                                                        |

---

## 6. Constats détaillés par axe d'audit

### Axe A — Stratégie, politique & planification _(CTAL-TM Ch.1 ; TMMi 2.1/2.2)_

- **A.1 Politique de test** — _TMMi P / CTAL Émergent_. Pas d'énoncé consolidé ; objectifs qualité
  dispersés (`docs/03-standards-developpement.md:5-6`, `:17`), seul KPI réel = couverture
  (`docs/03-standards-developpement.md:91-92`, appliquée via `vitest.config.mts`).
- **A.2 Stratégie de test** — _TMMi L / CTAL Établi_. Stratégie de fait cohérente : pyramide et types
  outillés (`docs/03-standards-developpement.md:78-93`), architecture de test tabulée
  (`docs/15-spec-tests-e2e-stack-reelle.md:65-72`), boucle d'amélioration pilotée par incident
  (`docs/15-spec-tests-e2e-stack-reelle.md:11-31`) — mais **non nommée** et **sans risk-based testing**.
- **A.3 Estimation** — _TMMi N / CTAL Absent_. Aucune estimation d'effort (peu pertinente en contexte
  solo ; ne pas sur-investir).
- **A.4 Planification** — _TMMi P/L / CTAL Émergent-Établi_. Pas de plan de test ; planification portée
  par le plan de **développement** (`docs/05-plan-de-developpement.md`, jalons M1→M9 `:277-289`),
  **critères de sortie = DoD** (`docs/15-spec-tests-e2e-stack-reelle.md:36-46`), **gates CI**
  (`.github/workflows/ci.yml:104-105,148-149,215-216,254-265`) ; **critères d'entrée absents**.

### Axe B — Pilotage, contrôle & mesure _(CTAL-TM Ch.1 ; TMMi 2.3/4.1/4.2)_

- **B.1 Métriques collectées** — _TMMi P / CTAL Émergent_. Couverture 100 % bloquante sur 7 libs
  (`libs/*/vitest.config.mts`), mais reporters **locaux** (`text`/`html`), **aucun JUnit/lcov/json**.
  Taux de réussite, densité de défauts, flakiness, durée : non instrumentés.
- **B.2 Reporting & tendances** — _TMMi N / CTAL Absent→Émergent_. **Aucun artefact CI** (pas
  d'`upload-artifact`, pas de `GITHUB_STEP_SUMMARY`, pas de badge) ; reporting = **prose manuelle**
  dans `docs/06-etat-davancement.md` (compteurs de tests saisis à la main).
- **B.3 Contrôle / gates** — _TMMi L / CTAL Établi_. Gates bloquants robustes (`.github/workflows/ci.yml`).
  **Incohérence** : objectif « ≥ 80 % global » (`docs/03-standards-developpement.md:91`) **déclaré mais
  non enforced** (apps/contracts sans seuil).
- **B.4 Mesure qualité produit (L4)** — _TMMi N / CTAL Émergent_. Observabilité **conçue mais inerte** :
  pipeline métriques OTel→Prometheus non câblé (`docs/exploitation/observabilite.md:21`,`:255-289`) →
  seuils/alertes définis mais non déclenchables.

### Axe C — Risque produit & tests basés sur le risque _(CTAL-TM Ch.2)_

- **C.1 Analyse de risque produit** — _CTAL Émergent_. Deux tables qualitatives **non cotées**
  (`docs/05-plan-de-developpement.md:291-299`, `docs/15-spec-tests-e2e-stack-reelle.md:117-125`) ;
  risque porté **implicitement** par les invariants `INV-01..08` (`docs/02-modele-de-cout.md:184-191`).
  **Pas de registre likelihood × impact**, pas de niveaux de risque pilotant l'effort de test.
- **C.2 Traçabilité risque → test** — _CTAL Émergent→Établi_. Traçabilité **modèle→critère→test**
  exemplaire (`docs/17-tests-model-based-ct-mbt.md:133-176`) mais **non indexée sur le risque** ;
  `INV-02/03/07/08` non tracés par ID.
- **C.3 Risques techniques gérés comme risques** — _CTAL Établi (maîtrise) / Émergent (gestion)_.
  Robustesse implémentée **et testée** (outbox transactionnel, idempotence, circuit-breaker,
  `rate-limit.guard.spec.ts`, Pact bloquant) — mais peu de risques **nommés/cotés** ; latence
  `/couts/annuel` non couverte par un test de perf ; risques résiduels dispersés (ADR-0005, observabilité).

> **Distinction clé** : le projet obtient une **robustesse sans gestion de risque formalisée**.
> L'atténuation _de facto_ est solide ; la **planification de test basée sur le risque** (cœur du
> CTAL-TM Ch.2) est quasi absente.

### Axe D — Gestion des anomalies & prévention _(CTAL-TM Ch.3 ; TMMi 5.1)_

- **D.1 Processus d'anomalie** — _TMMi P / CTAL Émergent_. **Aucun outil** (pas d'`ISSUE_TEMPLATE`,
  pas de tracker) ; défauts en **prose** (`docs/06-etat-davancement.md`) et commits `fix:`. Le
  `CHANGELOG.md` promis (`docs/03-standards-developpement.md:113`) est **absent**. Mini-backlog ad hoc
  à 2 entrées (`docs/06-etat-davancement.md:712-723`).
- **D.2 Traçage mesuré (DDP, densité, fuite)** — _TMMi N / CTAL Émergent_. **Zéro métrique d'anomalie**.
  Le **niveau de détection est tracé en prose** (bugs trouvés par E2E stack `docs/06:1219-1230`,
  par E2E API `docs/06:576`, par audit) — donc la matière d'un DDP **existe** mais n'est **jamais
  agrégée**. L'auto-évaluation « 0 bug » masque des fuites pourtant documentées
  (`docs/03-standards-developpement.md:84-86`).
- **D.3 Analyse causale & prévention (L5)** — _TMMi P / CTAL Établi (non-régression) – Émergent (causale)_.
  **Point fort réel** : non-régression systématique annotée (`apps/web/e2e/planning-creche.stack.e2e.spec.ts:4`,
  `apps/web/src/foyer/ContratForm.test.tsx:113`), garde-fous **de classe** (`libs/shared-kernel/src/lib/purete.guard.spec.ts`,
  `apps/svc-foyer/src/contract/frontieres.boundary.spec.ts`), action de processus post-fuite
  (règle E2E-stack `docs/03-standards-developpement.md:83-86` + `.github/pull_request_template.md:9`).
  **Mais** analyse causale **ad hoc** (2 occurrences) et efficacité des actions **non mesurée**.

### Axe E — Conception, exécution, environnement & données _(TMMi 2.4/2.5 ; CTAL-TM)_

- **E.1 Techniques black-box** — _TMMi L / CTAL Établi→Optimisé_. BVA 3 points, tables de décision
  combinatoires, transition d'états (0-switch + 1-switch), property-based
  (`libs/foyer/domain/src/lib/foyer.mbt.spec.ts:213-424`,
  `libs/tarification/domain/src/lib/psu/bareme-effort-psu.mbt.spec.ts:22-54`). _Angle mort_ : peu
  appliquées aux DTO/controllers.
- **E.2 Dérivation depuis modèles** — _TMMi F / CTAL Optimisé_. Matrice de traçabilité
  (`docs/17-tests-model-based-ct-mbt.md:133-176`), oracles ancrés CT-xx
  (`apps/api-gateway/src/e2e/parcours.e2e.spec.ts:51`). _Écart mineur_ doc↔impl sur l'état S4.
- **E.3 Tests de contrat (Pact)** — _TMMi F / CTAL Optimisé_. Consumer + provider (sur bundle réel +
  Postgres) + garde `can-i-deploy` (`.github/workflows/ci.yml:254-265`). Registre = **fichiers** (pas
  de broker, assumé ADR-0005).
- **E.4 Exécution CI reproductible** — _TMMi F / CTAL Optimisé_. `affected`, smoke-stack réel,
  E2E stack, teardown `down -v`, lockfile gelé. _Écart_ : E2E stack non filtré par projets affectés.
- **E.5 Environnements versionnés** — _TMMi F / CTAL Établi→Optimisé_. `docker-compose.yml` + CI
  éphémères alignés ; rate-limit E2E isolé de la prod (`docker-compose.yml:259-262`). _Écart_ : images
  d'observabilité en `latest` (non épinglées).
- **E.6 Données de test maîtrisées** — _TMMi F / CTAL Optimisé_. Seed **idempotent** + oracle
  `--verify` (`scripts/seed-demo.mjs:20-34`,`:314-396`), isolation par retour à l'état nominal.
  _Écart_ : jeu **mono-foyer**.
- **E.7 Pyramide de tests** — _CTAL Établi→Optimisé_. Base unit dominante, contrat intermédiaire, E2E
  fin et ciblé ; pas d'inversion.
- **E.8 Angles morts NFT** — _CTAL Émergent_. **Aucun test de performance/charge** ; sécurité
  _fonctionnelle_ testée (`apps/api-gateway/src/security/rate-limit.guard.spec.ts`) mais **aucune
  chaîne SCA/SAST/DAST** en CI.

### Axe F — Amélioration, outils, NFT & revues _(CTAL-TM Ch.4/5 ; TMMi 3.4/3.5/5.3)_

- **F.1 Amélioration continue** — _TMMi P (L5) / CTAL Établi_. Amélioration **pilotée par modèle**
  (audits ISTQB → phases CT-UT puis CT-MBT, `docs/17-tests-model-based-ct-mbt.md:196-198`), post-mortems
  (`docs/06-etat-davancement.md:1232-1257`) — mais **informelle, non mesurée**.
- **F.2 Outils & automatisation** — _TMMi S / CTAL Établi→Optimisé_. Pyramide outillée, Nx `affected`,
  gates bloquants. _Écart_ : **ROI/maintenabilité non chiffrés** (pas de taux de flakiness, durée
  tendancielle).
- **F.3 Tests non fonctionnels** — _TMMi P (L3) / CTAL Émergent→Établi (sécurité Absent)_. a11y
  systématique (`apps/web/e2e/a11y.e2e.spec.ts`) ; **aucune SCA/Dependabot/CodeQL** ; perf/chaos ad hoc.
- **F.4 Revues par les pairs** — _TMMi L (L3) / CTAL Établi_. PR template + husky/lint-staged +
  commitlint (`.husky/`, `.github/pull_request_template.md`). _Réserve_ : **pas de relecteur humain
  indépendant** (bus factor = 1).
- **F.5 Organisation & formation** — _N/A_. Sans objet (solo IA-assisté) ; à **documenter comme N/A**.

---

## 7. Verdict TMMi & chemin vers le niveau supérieur

**Niveau actuel : 1 (Initial)** — bloqué au franchissement du niveau 2 par les PA **2.1** (Policy &
Strategy) et **2.2** (Planning) en _Partially_, malgré un socle d'exécution déjà _Fully_.

**Pour atteindre un Niveau 2 _complet_ et auditable** (essentiellement documentaire) :

1. **PA 2.1** → produire un énoncé de **politique de test** (objectifs qualité + 2-3 KPI déjà
   disponibles) et promouvoir la stratégie implicite (`docs/03` §6 + `docs/15` §4) en **document
   « Stratégie de test »** nommé.
2. **PA 2.2** → rédiger un **plan de test léger par phase** (items, niveaux, **critères d'entrée**,
   critères de sortie reliés aux KPI, environnement, risques).
3. **PA 2.3** → publier les métriques de test en **artefacts CI** (JUnit + couverture) et un résumé
   (`GITHUB_STEP_SUMMARY`), pour passer du contrôle binaire (vert/rouge) à une **mesure**.

**Pré-requis pour viser le Niveau 3 puis 4** : combler le **Non-functional Testing** (sécurité/perf
en régression, PA 3.4) et **câbler la mesure** (PA 4.1/4.2 — pipeline OTel→Prometheus opérant), qui
est aujourd'hui le **plafond structurel** de la progression.

---

## 8. Feuille de route priorisée (recommandations consolidées)

> Le présent audit est **un état des lieux** : les actions ci-dessous sont **recommandées**, non
> appliquées. Elles capitalisent au maximum sur la matière déjà existante (dispersée dans `docs/06`,
> les commits, la CI), pour un coût marginal.

### Priorité 1 — leviers à fort effet / faible coût

| #    | Action                                                                                                                            |   Axe   | PA visée |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | :-----: | :------: |
| P1-1 | **Plan de test léger par phase** (entrée/sortie explicites, reliés aux KPI)                                                       |   A.4   |   2.2    |
| P1-2 | **Publier les métriques de test en CI** (reporters JUnit + lcov/json-summary en artefacts + `GITHUB_STEP_SUMMARY`)                | B.1/B.2 | 2.3/4.1  |
| P1-3 | **Aligner discours/réalité couverture** : enforcer un seuil global ≥ 80 % _ou_ retirer la cible de `docs/03:91`                   |   B.3   |   2.3    |
| P1-4 | **Registre de risque produit coté** (likelihood × impact → niveau → test), consolidant `docs/05` + `docs/15` + risques techniques | C.1/C.3 |   2.2    |
| P1-5 | **Compléter la traçabilité INV-xx → test** (ajouter `INV-02/03/07/08`)                                                            |   C.2   |    —     |
| P1-6 | **Chaîne sécurité minimale en CI** : Dependabot + `pnpm audit` bloquant (high/critical), idéalement CodeQL                        | E.8/F.3 |   3.4    |
| P1-7 | **Ligne « cause racine + action de prévention »** dans chaque commit `fix:` (le test de non-régression existe déjà)               |   D.3   |   5.1    |

### Priorité 2 — consolidation

| #    | Action                                                                                                                  |   Axe   | PA visée |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | :-----: | :------: |
| P2-1 | **Énoncé de politique de test** + KPI (couverture, défauts trouvés en usage réel, flakiness)                            |   A.1   |   2.1    |
| P2-2 | **Document « Stratégie de test » nommé** (objectif/déclencheur/oracle/critère par niveau)                               |   A.2   |   2.1    |
| P2-3 | **Câbler le pipeline métriques OTel→Prometheus** (rendre seuils/alertes opérants) + Alertmanager                        |   B.4   |   4.2    |
| P2-4 | **GitHub Issues + `ISSUE_TEMPLATE/bug.yml`** (gravité, priorité, niveau de détection, statut)                           |   D.1   |    —     |
| P2-5 | **Tableau d'anomalies structuré** (id / gravité / niveau de détection / phase d'introduction / commit) → DDP par niveau |   D.2   |   5.1    |
| P2-6 | **Smoke de performance** (k6/autocannon) sur `/api/v1/couts/annuel` avec SLO p95 (~0,93 s déjà mesuré)                  | E.8/F.3 |   3.4    |
| P2-7 | **Restreindre `e2e-stack`/`smoke-stack` aux déployables affectés** (temps CI)                                           |   E.4   |   2.5    |
| P2-8 | **Épingler les versions des images d'observabilité** (`latest` → tag figé)                                              |   E.5   |   2.5    |
| P2-9 | **Tracer le verdict de la revue assistée IA dans la PR** (substitut au relecteur humain)                                |   F.4   |   3.5    |

### Priorité 3 — optimisation / maturité supérieure

| #    | Action                                                                                                              |   Axe   | PA visée |
| ---- | ------------------------------------------------------------------------------------------------------------------- | :-----: | :------: |
| P3-1 | **Registre « amélioration du test »** centralisé (audits → écarts → actions → résultat mesuré)                      |   F.1   |   5.3    |
| P3-2 | **Métriques de processus** (DRE, échappées E2E vs unit, durée CI, taux de re-run) suivies phase à phase             | F.1/B.2 |   4.1    |
| P3-3 | **Mutation testing** sur les libs domaine + tracer `numRuns` MBT (qualité du test lui-même)                         |   B.4   |   4.1    |
| P3-4 | **Diversifier les jeux de données** (foyers T1/T2, multi-modes) au-delà du foyer de référence unique                |   E.6   |   2.5    |
| P3-5 | **Étendre BVA/tables de décision aux DTO d'entrée** gateway (formats mois, plages horaires)                         |   E.1   |   2.4    |
| P3-6 | **Chaos automatisé** (couper un service aval) en job non bloquant + **test de latence de projection** NATS          | E.8/F.3 |   3.4    |
| P3-7 | **Documenter explicitement** les PA d'organisation/formation comme **N/A** (et la compensation IA + hooks + CI)     |   F.5   | 3.1/3.2  |
| P3-8 | **Honorer le `CHANGELOG.md`** via `nx release` (déjà câblé) ; corriger doc 17 (état S4) ; matrice CT-xx centralisée | D.1/E.2 |    —     |

---

## 9. Conclusion

`creche-planner` est un cas d'école de **maturité technique de test élevée sur une gouvernance de
test émergente**. Le **niveau d'industrialisation effectif** des tests (conception, automatisation,
environnements, données, contrats, MBT) atteint un **TMMi niveau 2 _Fully_ sur ses PA d'exécution**,
avec des **îlots de niveau 3 à 5** (revues outillées, a11y systématique, prévention par garde-fous,
amélioration pilotée par modèle). Le **niveau formel reste 1** uniquement parce que les **artefacts
de gestion** (politique, stratégie, plan, mesure, registre de risque, gestion d'anomalies) sont
**implicites** plutôt que **nommés et auditables**.

Le meilleur investissement n'est donc **pas** de produire plus de tests — la couverture et la
robustesse sont déjà remarquables — mais de **formaliser et mesurer** ce qui existe déjà :
**structurer** la matière première abondante de `docs/06`, **publier** les métriques que la CI produit
déjà, et **expliciter** les critères et les risques. C'est le chemin le plus court et le moins coûteux
vers un **niveau 2 complet et auditable**, puis vers la **mesure** qui débloque les niveaux supérieurs.

---

_Méthode d'audit : 6 agents en parallèle (A — stratégie/planification ; B — pilotage/mesure ;
C — risque produit ; D — anomalies/prévention ; E — conception/exécution/environnement ;
F — amélioration/outils/NFT/revues), audit lecture seule, constats étayés `fichier:ligne`, synthèse
centralisée. Référentiels : ISTQB CTAL-TM v3.0 (2023) et TMMi._
