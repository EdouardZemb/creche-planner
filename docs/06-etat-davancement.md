# 06 — État d'avancement & guide de reprise

> Statut : **Phase 11 réalisée** (découplage micro-services — run-many 17 projets vert, pacts inchangés) · 2026-06-05
> **Phase 12 (accessibilité AA / CT-UT) planifiée** — spec/plan rédigés (docs 11/12), implémentation à venir. Détail Phase 11 en [§17](#17-phase-11-réalisée--découplage--maturité-micro-services) ; audits déclencheurs en [§16](#16-audits-dévaluation-2026-06-04--phases-11--12-à-réaliser).
> Ce document permet de **reprendre le projet dans un contexte neuf** (nouvelle
> conversation), sans tout redécouvrir.

## 1. Où on en est

| Phase                                              | État                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Cadrage                                  | ✅ validée (docs 01→05 + ADR-0001/0002)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Phase 1 — Socle technique                          | ✅ réalisée et DoD validée (y compris `docker compose up`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 2 — Cœur métier tarifaire                    | ✅ réalisée et DoD validée (domaine pur, 100 % couvert)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Phase 3 — Service Foyer                            | ✅ réalisée et DoD validée (domaine 100 %, outbox, contrat Pact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Phase 4 — Service Référentiel                      | ✅ réalisée et DoD validée (catalogue versionné, outbox, Pact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Phase 5 — Service Planification                    | ✅ réalisée et DoD validée (planning réel + simulé, outbox, Pact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Phase 6 — Intégration Tarification                 | ✅ réalisée et DoD validée (read model distribué, consommateurs idempotents, fallback résilient, Pact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Phase 7 — API Gateway / BFF                        | ✅ réalisée et DoD validée (agrégation `/api/v1`, clients résilients, auth/CORS/rate-limit, OpenAPI, E2E)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Phase 8 — Interface web                            | ✅ réalisée et DoD validée (`apps/web` React PWA, calendrier FullCalendar, coût + vue annuelle + simulation, E2E Playwright)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Phase 9 — Durcissement & exploit.                  | ✅ réalisée (bugs backlog #1/#2 corrigés, dashboards Grafana + alertes, sauvegardes + runbook, export CSV/PDF + a11y, rendu d'erreur 502) — run-many 13 projets vert ; validation runtime (chaos, dashboards live, Pact provider CRUD, `docker compose`) CI/Docker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Phase 10 — Navigation & interface**              | ✅ **réalisée** (front-only : design system + primitives, source URL/404/foyer introuvable, a11y clavier/modales/onglets, libellés & dates FR centralisés, responsive) — **136 tests web, run-many 13 projets vert, E2E Playwright vert**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Phase 11 — Découplage micro-services               | ✅ **réalisée** (contrats par contexte, versioning v1/v2, web typé OpenAPI, `nx release` par service, lib `resilience`, Dockerfile multi-stage, repli instrumenté) — **run-many 17 projets vert**, pacts inchangés. Suivi : pipeline métriques OTel→Prometheus à câbler (§17). [doc 09](09-spec-decouplage-microservices.md)/[10](10-plan-implementation-decouplage.md), [ADR-0004](adr/0004-decentralisation-des-contrats.md)/[0005](adr/0005-registre-de-contrats.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Phase 12 — Accessibilité AA (CT-UT)                | 🟡 **planifiée** (audit utilisabilité ISTQB CT-UT 2026-06-04 : 82/100, WCAG A / AA quasi atteint) — spec [doc 11](11-spec-accessibilite-ct-ut.md), plan [doc 12](12-plan-implementation-accessibilite.md). UT-01..10, 7 lots disjoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Phase de consolidation** (2026-06-07)            | 🟢 **en cours** — durcissement de l'ajustement de planning **par jour** (ajout/retrait, heures d'arrivée/départ, absence journée, portée « ce mois » vs durable), livré au merge `66e79c7` : tests `svc-planification`, **E2E saisie complète** (`planning-ajustement.stack.e2e.spec.ts`), **pacts additifs** (relecture planning), robustesse de l'**hydratation** (`useSaisieServeur`), rédaction de la **doc 16**, audit UX/a11y. Voir [doc 16](16-ajustement-planning.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Phase MBT** (2026-06-07)                         | ✅ **réalisée** — couche de tests **model-based** ISTQB **CT-MBT** ajoutée sur les **4 libs domaine + 1 modèle système** : machines à états (`fc.modelRun`), tables de décision (`it.each`), BVA, property-based (**fast-check 4.8**). **~260 cas MBT**, **couverture 100 % maintenue**, **0 bug** (conformité doc 02 confirmée). Voir [doc 17](17-tests-model-based-ct-mbt.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Exploit. — durcissement prod** (2026-06-11)      | ✅ **appliqué en prod** (serveur de prod) — **sauvegardes planifiées** (timer systemd quotidien 02:00 ; 2 bugs latents du `.sh` corrigés : mot de passe `PG_<DB>_PWD` et `printf -- `) + **exposition LAN fermée par non-publication des ports** : nouveau `docker-compose.override.yml` (dev/CI) republie les ports, la prod ne publie que Caddy (ufw-docker écarté car sa conf par défaut laisse passer le LAN). Vérifié depuis le LAN : ports internes (DB/Prom/Grafana/API) **refusés**, app OK (SPA 200, API 200, public 302), **Paperless intact**. PR #29/#30/#31. Voir [doc 24 §6](exploitation/24-plan-deploiement-serveur-ct-qdo.md) + [sauvegardes](exploitation/sauvegardes.md).                                                                                                                                                                                                                                                                              |
| **Web — accueil & résilience Access** (2026-06-11) | ✅ **mergée** (PR #35 `3eb9b18`, PR #36 `ad4d110` — CI 9/9 verte) — **(a) découverte du foyer à l'accueil** : sans foyer mémorisé, la SPA interroge `GET /api/v1/foyers` (nouveau bout-en-bout svc-foyer → BFF → OpenAPI → front, pact additif) et ouvre le planning du premier foyer ; liste vide ou erreur → création (jamais bloquant). **(b) session Cloudflare Access expirée distinguée de la panne serveur** : client API en `redirect:'manual'` → toute redirection sur `/api/v1/*` lève `AuthExpiredError` (le BFF ne renvoie jamais de 3xx) ; écran « Session expirée — Se reconnecter » (désenregistre le SW puis recharge → vraie navigation réseau → reconnexion Access) ; Workbox `navigateFallbackDenylist` sur `/cdn-cgi/`. Dev/LAN sans Access : comportement inchangé. **253 tests web verts**. Voir [doc 24 §11](exploitation/24-plan-deploiement-serveur-ct-qdo.md). **Reste : `node scripts/deploy.mjs` côté serveur** pour livrer les deux en prod. |

Branches de travail **mergées dans `main`** (`--no-ff`, local, non poussé) : `feat/phase-1-socle`,
`feat/phase-2-tarification`, `feat/phase-3-foyer`, `feat/phase-4-referentiel`,
`feat/phase-5-planification`, `feat/phase-6-tarification`, `feat/phase-7-gateway`, puis `feat/phase-8-web` (Phase 8).
Historique en Conventional Commits. **Convention de phase** : 1 branche `feat/phase-N-<slug>` → merge
`--no-ff` dans `main`.

## 2. Ce qui est livré (Phases 1 → 6)

```
apps/
  api-gateway/        [Phase 7] BFF NestJS (port 3000) — agrégation /api/v1 (foyers+contrats+couts) via
                      clients REST résilients ; transverses auth token/CORS/rate-limit (faits main) ;
                      versionnage URI (/v1 ; transverses neutres) ; OpenAPI publié (/api/openapi.json) ;
                      pacts consumer lectures+écritures (→ foyer/referentiel/planification/tarification) ;
                      test E2E API (bundle réel + aval simulé)
libs/
  shared-kernel/      Money, Duree, Tranche, DomainError — immuables, TS pur, 100 % couverts (TDD)
  contracts/          events/ (enveloppe IntegrationEvent Zod + Foyer + Référentiel + Planification) + dto/health +
                      openapi/ asyncapi/ (foyer.md, referentiel.md, planification.md)
  observability/      startTracing() (OpenTelemetry) + buildLoggerParams() (pino corrélé)
  tarification/
    domain/           [Phase 2] port PolitiqueTarifaire + stratégies PSU/ABCM + consolidation foyer
                      (CoutMois/LigneDeCout) — TS pur, 100 % couvert (CT-01..20), aucun réseau
  foyer/
    domain/           [Phase 3] value objects Foyer/Enfant + invariants + tranche dérivée
                      (Tranche.depuisRfr) — TS pur, 100 % couvert (19 tests)
  referentiel/
    domain/           [Phase 4] PeriodeValidite, ModeGarde, trancheDepuisNiveau, sélection de version
                      applicable + garde anti-chevauchement — TS pur, 100 % couvert (28 tests)
  planification/
    domain/           [Phase 5] SemaineType/PlageHoraire, ContratCreche, InscriptionAbcm, génération des
                      prestations du mois, planning simulé (calculerDeltaPlanning), calendrier
                      (joursDuMois) — TS pur, 100 % couvert (65 tests)
apps/
  svc-foyer/          [Phase 3] service NestJS : Postgres dédié (foyer/enfant/outbox), outbox
                      transactionnelle + relais NATS JetStream, API /api/foyers(/:id/enfants)
  svc-referentiel/    [Phase 4] catalogue versionné : Postgres dédié (grille_abcm/bareme_psu/
                      frais_fixes_abcm/jour_non_facturable/outbox), migration + seed 2026 au boot,
                      outbox + relais (stream REFERENTIEL), API /api/grilles/applicable & /grilles/abcm
  svc-planification/  [Phase 5] planning multi-modes : Postgres dédié (contrat/planning_mois[réel+simulé,
                      discriminant simule]/outbox), migration au boot, outbox + relais (stream PLANIFICATION),
                      client Référentiel (jours non facturables), API /api/contrats & /api/prestations
  svc-tarification/   [Phase 6] read model + calcul du coût : Postgres dédié (foyer/enfant/grille_tarifaire/
                      contrat/prestation_mois/processed_event ; outbox latente), migration au boot,
                      consommateurs JetStream idempotents (FOYER/REFERENTIEL/PLANIFICATION, durables,
                      max_deliver+backoff), clients REST résilients (timeout/retry/circuit-breaker),
                      API /api/couts & /api/couts/annuel (réutilise tarification/domain)
pacts/                contrats Pact versionnés : api-gateway → svc-foyer, → svc-referentiel,
                      → svc-planification, → svc-tarification (api-gateway-svc-tarification.json)
docker/               configs otel-collector, tempo, prometheus, grafana
docker-compose.yml    14 services : 5 apps + 4 Postgres (dont postgres-tarification) + NATS + collecteur OTel + Tempo + Prometheus + Grafana
Dockerfile            image générique paramétrée par ARG APP (linux/amd64)
.github/workflows/    CI nx affected (lint/typecheck/test/build) + 4 services Postgres pour les vérifs Pact
```

**Frontières de modules** (`.eslintrc.json`, règle `@nx/enforce-module-boundaries`) sur 2 axes :

- `type:domain` → `type:domain` uniquement ; `type:application` → +domain/contracts ;
  `type:infrastructure` → +application ; `type:app` → tout ; `type:contracts` → contracts seul.
- `context:<X>` → `context:<X>` + `context:shared`. Seule passerelle inter-contextes : `libs/contracts`.

## 3. Stack & versions clés

Node **24 LTS** (figé `.nvmrc` 24.16.0) · pnpm **10.34.2** (linker **isolé**) · Nx **22.7.5** · TypeScript **5.9** (strict +
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · NestJS **11** · Drizzle **0.45** +
postgres.js · NATS **2.29** · **Vitest 3.2 / Vite 6** (esbuild) · OpenTelemetry SDK **0.218** ·
pino **10** / nestjs-pino · Zod **4** · webpack (build apps) · Docker Desktop.

## 4. Commandes essentielles

```bash
pnpm install
pnpm nx run-many -t lint typecheck test build      # qualité (domaines à 100 %)
pnpm nx affected -t lint typecheck test build      # ce que la CI exécute (sur le diff)
pnpm nx test shared-kernel                          # tests domaine (couverture imposée)
pnpm nx test tarification-domain                    # domaine tarifaire (100 %, 55 tests)
pnpm nx test foyer-domain                            # domaine Foyer (100 %, 19 tests)
pnpm nx test referentiel-domain                      # domaine Référentiel (100 %, 28 tests)
pnpm nx test planification-domain                    # domaine Planification (100 %, 65 tests)
pnpm nx test svc-foyer                               # vérif Pact provider Foyer (skip si pas de Postgres)
pnpm nx test svc-referentiel                         # vérif Pact provider Référentiel (idem, base 5433)
pnpm nx test svc-planification                       # vérif Pact provider Planification (idem, base 5435)
pnpm nx test svc-tarification                         # vérif Pact provider Tarification (idem, base 5436)
pnpm nx test api-gateway                             # contrats Pact consumer (génèrent les pact files)
pnpm nx serve svc-referentiel                       # lance le Référentiel en dev (port 3001)
pnpm nx serve svc-foyer                              # lance le service Foyer en dev (port 3002)
pnpm nx serve svc-planification                     # lance la Planification en dev (port 3004)
pnpm nx serve svc-tarification                      # lance la Tarification en dev (port 3005)
docker compose up --build                           # toute la pile locale
docker compose down -v                              # arrêt + purge volumes
# Migrations Drizzle d'un service : depuis apps/<svc>/, drizzle-kit generate|migrate
```

Génération des libs (patterns à réutiliser) :

```bash
pnpm nx g @nx/js:lib libs/<contexte>/<couche> --name=<contexte>-<couche> \
  --importPath=@creche-planner/<contexte>-<couche> --unitTestRunner=vitest \
  --linter=eslint --bundler=tsc --tags="type:<...>,context:<...>" --no-interactive
```

> ⚠️ En Phase 2, `tarification/domain` a été **câblé à la main** en recopiant les fichiers
> de config de `shared-kernel` (package.json `exports`+`nx.tags`, tsconfig.\*, vitest, `.eslintrc.json`),
> **pas** via le générateur : sous Nx 22 ce dernier émet une config ESLint **plate**
> (`eslint.config.mjs`) incohérente avec le `.eslintrc.json` legacy du dépôt. Reproduire ce
> câblage manuel tant que le dépôt reste en config ESLint legacy.

## 5. Conventions à respecter (sinon ça casse)

1. **Imports relatifs en `.js`** dans le TS des libs (`moduleResolution: nodenext`) :
   `import { Money } from './money.js';` — sinon le build/typecheck échoue.
2. **Tags Nx obligatoires** à la génération (`type:*` + `context:*`) pour les frontières.
3. **Domaine = TS pur** : zéro dépendance framework dans `type:domain` (la règle de frontières le vérifie).
4. Après génération d'un projet, **ajouter `**/node_modules`à son`.eslintrc.json`** (`ignorePatterns`)
   — sinon ESLint scanne les libs symlinkées (voir ADR-0003).
5. **Money/Duree/Tranche** existent déjà : ne PAS les redéfinir, les importer de `@creche-planner/shared-kernel`.
6. Couverture **100 % exigée** sur tout domaine (`vitest.config.mts` → `thresholds`). Les fichiers
   **purement types** (`export type`/`interface` seuls, ex. `politique-tarifaire.ts`) sont à **exclure**
   du périmètre de couverture (aucun code exécutable, sinon v8 les compte à 0 %).
7. **Libs imbriquées par contexte** (`libs/<contexte>/<couche>`) : `pnpm-workspace.yaml` couvre
   `libs/*/*`, et la racine `tsconfig.json` doit **référencer** chaque lib. Les chemins relatifs des
   configs gagnent un niveau (`../../../` au lieu de `../../`).

## 6. Décisions techniques non-évidentes

Consignées dans **[ADR-0003](adr/0003-decisions-de-toolchain.md)** : Node 24, linker pnpm isolé,
épinglage Vitest 3 (rolldown KO sous Windows), `@nx/js:typescript-sync` désactivé, résolution
source des libs au build webpack (`resolve.conditionNames`), ignore `node_modules` par projet.

> 💡 Épisode d'exploitation : les crashes Docker initiaux venaient d'un **disque C: plein** (0 octet),
> pas du code. Garder de la marge disque (la pile + builds ≈ plusieurs Go).

## 7. Phase 2 livrée — détail

`libs/tarification/domain` (`@creche-planner/tarification-domain`, tags `type:domain` +
`context:tarification`), TS pur, **100 % couvert (55 tests)** :

- **Cœur** : `PolitiqueTarifaire<Saisie>` (port, pattern Stratégie), agrégats `CoutMois` +
  `LigneDeCout` (débits/crédits, total ≥ 0 → INV-06), gardes de saisie (INV-01), erreurs typées.
- **PSU** : `BaremeEffortPsu` (barème CNAF 2026), `TarifCrechePsu` — tarif horaire, mensualité
  lissée (heures arrondies au centième), complément à la minute, déduction d'absence éligible
  (préavis ≥ 2 j **ou** certificat, INV-08), bornes plancher/plafond.
- **ABCM** : `GrilleAbcm` (barèmes T1/T2/T3), `TarifCantineAbcm` (+ PAI part garde),
  `TarifPeriscolaireAbcm`, `TarifAlshAbcm`, `FraisFixesAbcm` (cotisation + 1ère inscription,
  rattachées à septembre), `UnitesAssociativesAbcm` (coût pilotable).
- **Consolidation** : `consoliderCoutMoisFoyer(couts[])`.
- **Oracle** : CT-01..CT-14 + CT-20 (requis) + CT-15..CT-18 (bonus) verts.

> La couche `tarification/application` n'a **pas** été créée : la Phase 2 est du domaine pur sans
> cas d'usage à orchestrer. Elle viendra quand un service (Phase 6, intégration tarification) en
> aura besoin — créer une lib vide maintenant casserait le seuil de couverture à 100 %.

## 8. Phase 3 — Service Foyer (✅ livré — conception de référence)

> **Réalisé.** Cette section décrit la conception **telle que livrée** ; elle sert désormais de
> **template d'émetteur d'événements** (outbox + relais + migrations au boot + contrat Pact) à
> reproduire en Phase 4. Détail des écarts et choix concrets ci-dessous (8.8).

### 8.1 Découpage recommandé (cohérent avec l'archi hexagonale du dépôt)

- `libs/foyer/domain` (`type:domain`, `context:foyer`, lib **TS pur, 100 % couvert en TDD**) :
  value objects `Foyer` / `Enfant`, invariants (ressources ≥ 0, ≥ 1 enfant à charge, RFR ≥ 0),
  dérivation `tranche = Tranche.depuisRfr(rfr)` — **réutiliser `Tranche`/`Money` du `shared-kernel`,
  ne rien redéfinir**. Câblage de lib **à la main** (cf. §4, recopier `libs/tarification/domain`).
- `apps/svc-foyer` (`type:app`, `context:foyer`) : persistance Postgres dédiée, **outbox** +
  publication NATS, API REST `/api/foyers` & `/api/foyers/:id/enfants`. Importe `foyer/domain` et
  `contracts` (autorisé : `type:app` → tout ; `context:foyer` → `context:shared`).

### 8.2 Template de service à copier (`apps/svc-referentiel` → `apps/svc-foyer`)

Le plus sûr est de **dupliquer `apps/svc-referentiel`** puis renommer/retaguer (le générateur Nest
émet du webpack + des targets custom non triviaux). Fichiers et patterns à reprendre tels quels :

- `src/main.ts` : `import './tracing.js'` **en 1ʳᵉ ligne**, `reflect-metadata`, `setGlobalPrefix('api')`,
  `enableShutdownHooks()`, logger pino injecté.
- `src/tracing.ts` : init OpenTelemetry (via `@creche-planner/observability` `startTracing`).
- `src/config.ts` : `loadConfig()` lit `PORT` / `DATABASE_URL` / `NATS_URL` avec défauts dev.
  Pour Foyer : **port 3002**, `postgres://foyer:foyer@localhost:5434/foyer`.
- `src/app.module.ts` : `ConfigModule.forRoot({isGlobal})`, `LoggerModule.forRoot(buildLoggerParams('svc-foyer'))`,
  `DatabaseModule`, `NatsModule`, `HealthModule` (+ futurs `FoyerModule`).
- `src/database/database.module.ts` : `@Global`, providers `PG_CLIENT` (postgres.js, connexion
  paresseuse, `max:5`) et `DRIZZLE` (`drizzle(sql)`), `onModuleDestroy` ferme le pool. Type `Database`.
- `src/database/schema.ts` + `drizzle.config.ts` : **définir les tables ici** (vide chez referentiel) ;
  `drizzle-kit generate` puis `migrate`.
- `src/messaging/nats.service.ts` : connexion **résiliente** (reconnect infini, réessai 5 s, drain au
  shutdown) ; `estConnecte()` / `getConnection()`.
- `src/health/*` : `HealthController` Terminus → `GET /api/health` (readiness DB+NATS) et
  `GET /api/health/live` (liveness). Indicateurs `DatabaseHealthIndicator` / `NatsHealthIndicator`.
- `package.json` (champ `nx`) : `tags: ["type:app","context:foyer"]`, targets `build`/`serve`/`prune`
  (webpack), deps NestJS 11 + `@nestjs/terminus` + `drizzle-orm` + `postgres` + `nats` + `nestjs-pino`.

### 8.3 Modèle Foyer (données de référence — doc 02 §0)

`ressourcesMensuelles = 6 716,92 €` · `RFR = 72 705 €` → `Tranche.depuisRfr` = **T3** ·
`nbEnfantsACharge = 2` · `nbParts` (à saisir) · enfants : **Mia** (08/12/2024), **Zoé** (12/03/2023).
Montants en `Money` (centimes). La tranche/RFR sont des **données du Foyer**, réactualisables (cf. `Q-05`).

### 8.4 Schéma DB + outbox

- Tables `foyer` (ressources, rfr, nb_enfants_a_charge, nb_parts) et `enfant` (foyer_id, prénom,
  date_naissance). Une **base dédiée** (un service = une base).
- Table `outbox` (id uuid, type, payload jsonb, occurred_at, trace_id, published_at nullable) :
  l'événement est écrit **dans la même transaction** que le changement d'état ; un relais le publie
  ensuite sur NATS et marque `published_at` (publication **idempotente**, clé = `id`).

### 8.5 Événements (dans `libs/contracts`, passerelle inter-contextes)

Définir `foyer.FoyerMisAJour.v1` et `foyer.EnfantAjoute.v1` via `integrationEventSchema(payload)`
(enveloppe Zod déjà figée : `id`/`type`/`source`/`version`/`occurredAt`/`traceId` + `payload`).
Documenter le canal dans `libs/contracts/src/lib/asyncapi/`.

### 8.6 docker-compose (ajouts)

```yaml
postgres-foyer: # image postgres:16-alpine, user/db "foyer", port 5434:5432,
  # volume pg-foyer, healthcheck pg_isready
svc-foyer: # build ARG APP=svc-foyer ; PORT 3002 ; DATABASE_URL vers postgres-foyer:5432 ;
  # NATS_URL ; OTEL_* ; depends_on postgres-foyer(healthy)+nats(healthy)
```

Ajouter le volume `pg-foyer:` et **référencer `apps/svc-foyer` dans la racine `tsconfig.json`**.

### 8.7 DoD Phase 3 (✅ validée)

- [x] `libs/foyer/domain` **100 % couvert** (TDD, 19 tests) ; `Tranche.depuisRfr(72705) = T3` testé.
- [x] Foyer de référence saisi via l'API ; lecture du foyer renvoie tranche **T3** déduite du RFR
      (vérifié par le **contrat Pact** : `GET /api/foyers/:id` → `tranche: 3`).
- [x] Événements `FoyerMisAJour`/`EnfantAjoute` écrits **dans la transaction** via l'outbox
      (table `outbox`) ; relais NATS JetStream idempotent (`Nats-Msg-Id` = `id`).
- [x] Contrat **Pact** (consommateur `api-gateway` → provider `svc-foyer`) vérifié, **bloquant en CI**.
- [x] `nx run-many -t lint typecheck test build` vert sur les **8 projets**.

### 8.8 Écarts & choix concrets de réalisation

- **Migrations au boot** : `MigrationService` applique les migrations Drizzle au démarrage (résilient,
  réessai 5 s comme NATS). Les SQL sont embarqués dans le bundle via les **assets webpack**
  (`dist/database/migrations`). `svc-referentiel` (schéma vide) n'avait pas ce besoin.
- **Outbox → JetStream** : le relais (`OutboxRelay`, tick 2 s) publie sur le stream `FOYER` (sujets
  `foyer.>`, provisionné au connect) avec dédup `Nats-Msg-Id`, puis marque `published_at`.
- **Contrat Pact** : le consommateur `api-gateway` (futur BFF, Phase 7) déclare ses attentes
  **dès maintenant** (contract-first) → `pacts/api-gateway-svc-foyer.json` versionné. La vérification
  provider **boote le bundle réel** contre Postgres (évite les soucis de métadonnées de décorateurs
  sous esbuild) ; elle **skip proprement en local sans base**, et est **bloquante en CI** (service
  Postgres + `CI=true`). `apps/api-gateway` et `apps/svc-foyer` ont reçu un câblage **vitest**
  (`vitest.config.mts` + `tsconfig.spec.json`, specs exclus du `tsconfig.app.json`).
- **`docker compose up`** et la vérif Pact provider exigent Docker/Postgres : non rejouables hors CI
  dans un environnement sans Docker — la CI les couvre.

> ⚠️ Rappels qui cassent sinon (cf. §5) : imports `.js`, tags `type/context`, domaine = TS pur,
> `**/node_modules` dans le `.eslintrc.json` du nouveau projet, chemins `../../../` pour une lib
> imbriquée, exclusion couverture des fichiers purement types. **Apps en CJS** (pas de
> `type: module`) → **pas d'`import.meta`** dans les specs : dériver les chemins de `process.cwd()`.

## 9. Phase 4 — Service Référentiel (✅ livré) + guide ayant servi à la Phase 5

### 9.1 Phase 4 livrée — détail (conception de référence)

- **`libs/referentiel/domain`** (`type:domain`, `context:referentiel`, câblé **à la main** comme
  `tarification`/`foyer`, **100 % couvert, 28 tests**) : `PeriodeValidite` (bornes ISO, `contient`,
  `chevauche`), `ModeGarde` (+ `parseModeGarde`/`estModeAbcm`), `trancheDepuisNiveau` (réutilise
  `Tranche` du `shared-kernel`), `selectionnerVersionApplicable` + `verifierAbsenceChevauchement`.
  Le domaine porte les invariants de **versionnement**, pas les montants (validés par Zod/`Money`).
- **`apps/svc-referentiel`** (enrichi, pas recréé) : tables versionnées `grille_abcm`, `bareme_psu`,
  `frais_fixes_abcm`, `jour_non_facturable`, `outbox` ; migration `0000_referentiel_initial` appliquée
  au boot (`MigrationService` + asset webpack) ; **`SeedService`** amorce les données de référence 2026
  (doc 02 §4 : grilles T1/T2/T3, barème PSU, frais fixes, fermetures crèche) — idempotent et résilient.
- **Outbox + relais** : `OutboxRelay` (tick 2 s) publie sur le stream `REFERENTIEL` (sujets
  `referentiel.>`, dédup `Nats-Msg-Id`). À chaque `publierGrilleAbcm`, un `GrillePubliee` est inséré
  **par mode ABCM** dans la transaction.
- **Événement** : `referentiel.GrillePubliee.v1` dans `libs/contracts` (+ `asyncapi/referentiel.md`).
  Payload : `grilleId`, `mode` (ABCM), `tranche`, `valideDu`, `valideAu` (nullable).
- **API** : `POST /api/grilles/abcm` (publication), `GET /api/grilles/applicable?date&tranche&mode`
  (cœur DoD ; dispatch ABCM → grille / `CRECHE_PSU` → barème), `GET /api/frais-fixes/applicable?date`,
  `GET /api/calendrier/jours-non-facturables`.
- **Contrat Pact** : consommateur `api-gateway` (`pacts/api-gateway-svc-referentiel.json`) → cantine
  T3 2026 = **1268 centimes** ; provider `svc-referentiel` vérifié (boot bundle + base réelle,
  `stateHandler`), **bloquant en CI** (service `postgres-referentiel` + `REFERENTIEL_DATABASE_URL`).

### 9.2 DoD Phase 4 (✅ validée)

- [x] Grilles/barèmes versionnés saisis (seed 2026) ; API « grille applicable à (date, tranche, mode) ».
- [x] Événement `GrillePubliee` émis via l'outbox (par mode ABCM, dans la transaction).
- [x] Contrat **Pact** (provider `svc-referentiel`) vérifié, **bloquant en CI**.
- [x] `nx run-many -t lint typecheck test build` vert sur les **9 projets**.

> ⚠️ Écarts/pièges Phase 4 : `bareme_psu.plancher/plafond` rendus **nullable** (bornes optionnelles,
> l'oracle CT-01 ne les applique pas) ; le `GrillePubliee` est émis **par mode** (un événement
> CANTINE/PERISCOLAIRE/ALSH) car une ligne `grille_abcm` couvre les trois ; la vérif Pact provider
> utilise `REFERENTIEL_DATABASE_URL` (≠ `DATABASE_URL` du provider Foyer) → 2 bases en CI.

### 9.3 Point de départ Phase 5 — Service Planification (guide ayant servi à la reprise)

> ✅ **Phase 5 désormais livrée** — voir le détail tel que réalisé en **§10**. Ce guide initial est
> conservé à titre d'historique. **Écart notable vs ce guide : le port retenu est `3004` et non `3003`**
> (l'hôte 3003 est occupé par Grafana) — corriger toute lecture en conséquence.
>
> Objectif : **planning des activités de garde par enfant** (doc 05 → Phase 5). Contrats & semaines
> types crèche, inscriptions péri/cantine/ALSH, planning **réel et simulé**, génération mensuelle
> (en excluant les jours non facturables du Référentiel). Émet `ContratCree`/`PlanningModifie`
> (outbox) et expose « prestations du mois ».

**Réutiliser `apps/svc-foyer` / `apps/svc-referentiel` comme templates** (émetteur d'événements complet) :

- **Créer `apps/svc-planification`** : le plus sûr est de **dupliquer `apps/svc-foyer`** puis renommer/
  retaguer (`type:app`, `context:planification`), port **3004** (⚠️ **pas 3003** : Grafana occupe l'hôte
  3003), base dédiée `planification:5435` (ajouter `postgres-planification` au `docker-compose.yml` + à la
  CI, et la racine `tsconfig.json`).
- **Domaine `libs/planification/domain`** (`type:domain`, `context:planification`, TS pur 100 %, câblé
  à la main) : `Contrat`, `SemaineType`, génération du planning mensuel (réservé = facturé, doc 02 §4.4 bis),
  planning **simulé** (delta). Réutiliser `Duree`/`Money`/`Tranche` du `shared-kernel`.
- **Événements** : `planification.ContratCree.v1` / `planification.PlanningModifie.v1` dans
  `libs/contracts` (cf. `referentiel-events.ts` + `asyncapi/`). Stream `PLANIFICATION`, sujets `planification.>`.
- **Dépendances aval** : consommer les **jours non facturables** du Référentiel
  (`GET /api/calendrier/jours-non-facturables`) pour exclure fériés/fermetures (INV-04).
- **Contrat Pact** : interaction consommateur « prestations du mois » + vérif provider `svc-planification`
  (copier `apps/svc-referentiel/src/contract/referentiel.provider.pact.spec.ts` + câblage vitest).

### 9.4 DoD Phase 5 _(✅ validée — voir §10.2)_

- [x] Planning crèche de Mia & Zoé + planning ABCM type de Zoé corrects (doc 02 §7).
- [x] Événements `ContratCree`/`PlanningModifie` émis via l'outbox.
- [x] Contrat **Pact** (provider `svc-planification`) vérifié, bloquant en CI.
- [x] `nx run-many -t lint typecheck test build` vert sur les **11 projets**.

> ⚠️ Mêmes rappels qu'en §5/§8.8 (imports `.js`, tags `type/context`, domaine = TS pur,
> `**/node_modules` dans le `.eslintrc.json`, chemins `../../../` pour une lib imbriquée, exclusion
> couverture des fichiers purement types, `process.cwd()` dans les specs d'app — pas d'`import.meta`).

## 10. Phase 5 — Service Planification (✅ livré) + point de départ Phase 6

### 10.1 Phase 5 livrée — détail (conception de référence)

- **`libs/planification/domain`** (`type:domain`, `context:planification`, câblé **à la main** comme
  `tarification`/`foyer`/`referentiel`, **100 % couvert, 65 tests**) : `SemaineType`/`PlageHoraire`,
  `ContratCreche` (mensualité lissée), `InscriptionAbcm` (cantine/péri/ALSH), génération des
  **« prestations du mois »** (quantités, **pas de montant** — la valorisation reste à la Tarification),
  planning **simulé** (`calculerDeltaPlanning`), calendrier (`joursDuMois`, `estJourOuvertureEcole`).
  Exclut les **jours non facturables** reçus en paramètre (INV-04). Réutilise `Duree`/`Money`/`Tranche`
  du `shared-kernel`.
- **`apps/svc-planification`** (dupliqué de `svc-foyer` puis retagué `type:app`/`context:planification`) :
  **port 3004**, base dédiée `postgres://planification:planification@localhost:5435/planification` ;
  tables `contrat`, `planning_mois` (réel **et** simulé dans une **table unique**, discriminant booléen
  `simule`, `UNIQUE(contrat_id, mois, simule)`), `outbox` ; migration `0000_planification_initial`
  appliquée au boot (`MigrationService` + asset webpack).
- **Outbox + relais** : `OutboxRelay` (tick 2 s) publie sur le stream `PLANIFICATION` (sujets
  `planification.>`, dédup `Nats-Msg-Id`). `ContratCree` et `PlanningModifie` insérés **dans la
  transaction** du changement d'état.
- **Événements** : `planification.ContratCree.v1` (payload `contratId`/`foyerId`/`enfant`/`mode`/
  `valideDu`/`valideAu`) & `planification.PlanningModifie.v1` (payload `contratId`/`mois`/`simule`)
  dans `libs/contracts` (+ `asyncapi/planification.md`).
- **API** (préfixe `/api`) : `POST /api/contrats` (→ `ContratCree`), `PUT /api/contrats/:id/plannings/:mois?simule=`
  (→ `PlanningModifie`), `GET /api/prestations?contrat&mois&simule` (**cœur DoD** : génère les prestations
  en excluant les jours non facturables obtenus via `GET /api/calendrier/jours-non-facturables` du
  Référentiel, config `REFERENTIEL_URL`).
- **Contrat Pact** : consommateur `api-gateway` (`pacts/api-gateway-svc-planification.json`, interaction
  « prestations du mois ») ; provider `svc-planification` vérifié (boot bundle + base réelle,
  `stateHandler`), **skip propre en local sans Postgres, bloquant en CI** (service `postgres-planification`
  - `PLANIFICATION_DATABASE_URL`).

### 10.2 DoD Phase 5 (✅ validée)

- [x] Planning crèche **Mia 126,50 h/mois & Zoé 118,79 h/mois** (CT-02/03) + ABCM Zoé — cantine
      16 j (CT-10), péri soir×12 + matin×8 (CT-11), ALSH 5 j (CT-12) — corrects via les prestations du mois.
- [x] Événements `ContratCree`/`PlanningModifie` émis **via l'outbox** (stream `PLANIFICATION`).
- [x] Contrat **Pact** (provider `svc-planification`) vérifié, **bloquant en CI**.
- [x] `nx run-many -t lint typecheck test build` vert sur les **11 projets** ; `format:check` OK.

### 10.3 Écarts & pièges Phase 5

- **Port `3004` et non `3003`** : l'hôte 3003 est occupé par **Grafana** ; c'est un **écart assumé** vs
  la consigne initiale §9.3 (qui disait 3003). À répercuter dans toute mention résiduelle.
- **Planning réel/simulé dans une table unique** (`planning_mois`) avec discriminant booléen `simule`
  et `UNIQUE(contrat_id, mois, simule)` — pas deux tables.
- **Client Référentiel résilient** : si le Référentiel est injoignable, le client renvoie un **tableau
  vide** de jours non facturables (dégradation propre, pas de crash de l'endpoint prestations).
- Vérif Pact provider via `PLANIFICATION_DATABASE_URL` (≠ `DATABASE_URL`) → **3 bases en CI**.

### 10.4 Point de départ Phase 6 — Intégration Tarification (guide de reprise)

> Objectif : le calcul devient un **service autonome et résilient** (doc 05 → Phase 6). `svc-tarification`
> expose « coût du mois/an » par enfant, par mode, consolidé foyer.

**Réutiliser les émetteurs d'événements** (`apps/svc-foyer`, `apps/svc-referentiel`,
`apps/svc-planification`) comme templates de service, **ET bâtir le consommateur** :

- **Créer `apps/svc-tarification`** : dupliquer un service existant puis retaguer (`type:app`,
  `context:tarification`), port/base dédiés (ajouter `postgres-tarification` au `docker-compose.yml` + CI
  - racine `tsconfig.json`). Réutiliser le **domaine `libs/tarification/domain`** déjà à 100 %
    (politiques PSU/ABCM + `consoliderCoutMoisFoyer`).
- **Consommateur idempotent** : souscription JetStream aux streams `FOYER`/`REFERENTIEL`/`PLANIFICATION`
  (durable, dédup par `id` d'événement) alimentant un **read model** du coût (eventual consistency).
- **Fallback synchrone** : si un read model est froid/incomplet, appel REST direct au service amont avec
  **timeout / retry / circuit-breaker**.
- **API** « coût du mois/an » par enfant, par mode, consolidé foyer.
- **DoD** : `saisie → événements → GET coût` cohérent ; **CT-04/CT-10/CT-11/CT-20** reproduits via le
  chemin distribué complet ; contrat Pact (provider `svc-tarification`) bloquant en CI ; run-many vert.

> ⚠️ Mêmes rappels qu'en §5/§8.8/§10.3 (imports `.js`, tags `type/context`, domaine = TS pur,
> `**/node_modules` dans le `.eslintrc.json`, chemins `../../../` pour une lib imbriquée, exclusion
> couverture des fichiers purement types, `process.cwd()` dans les specs d'app — pas d'`import.meta` ;
> vérifier le **port hôte libre** avant de le figer, cf. le conflit Grafana/3003).

## 11. Phase 6 — Intégration Tarification (✅ livré) + point de départ Phase 7

### 11.1 Phase 6 livrée — détail (conception de référence)

Premier service **consommateur** du dépôt (les Phases 3→5 ont livré des **émetteurs**). `apps/svc-tarification`
(`type:app`, `context:tarification`, dupliqué d'un service existant puis retagué) : **port 3005**, base dédiée
`postgres://tarification:tarification@localhost:5436/tarification`, migration `0000_tarification_initial`
appliquée au boot (`MigrationService` + asset webpack).

- **Read model** (tables, base dédiée) : `foyer` / `enfant` (projetés du stream `FOYER`),
  `grille_tarifaire` (du stream `REFERENTIEL`, paramètres tarifaires bruts en `jsonb`, versionnés par
  `(mode, tranche, valide_du)`), `contrat` (identité foyer/enfant/mode, du stream `PLANIFICATION`),
  `prestation_mois` (quantités du mois, `UNIQUE(contrat_id, mois, simule)`), et `processed_event`
  (journal d'idempotence, clé = `id` d'enveloppe). Le détail tarifaire reste **brut** (`jsonb`) ; aucune
  formule en base — la valorisation est faite par le domaine au moment de lire.
- **Consommateurs JetStream idempotents** (`JetStreamConsumer`) : un consommateur **durable** par stream
  (`tarification-foyer`/`-referentiel`/`-planification`), création **idempotente** (réutilise un
  consommateur existant), boucle ACK/NAK. La dédup **autoritative** est l'insert `processed_event`
  **dans la transaction** d'upsert (`onConflictDoNothing` ; rejeu at-least-once = no-op). Les
  re-livraisons sont **bornées** (`max_deliver: 10` + `backoff` escaladé `[1s, 5s, 15s, 30s]`, en
  **nanosecondes** via `nanos()`) : un événement génuinement orphelin (ex. `PlanningModifie` dont le
  `ContratCree` n'arrivera jamais) cesse de NAKer en boucle, tandis qu'un désordre **transitoire** (un
  `ContratCree` en retard de quelques secondes) est rattrapé dès le 1ᵉʳ palier.
- **Clients de repli résilients** (`type:infrastructure` / `FallbackModule`) : clients REST
  `svc-planification` / `svc-referentiel` avec **timeout + retry + circuit-breaker**, pour aller chercher
  une donnée manquante quand une projection est froide ou incomplète (`PlanningModifie` ne porte que
  `{contratId, mois, simule}` → les **quantités** sont récupérées via le client Planification).
- **Orchestration du coût** : `GET /api/couts?foyer&mois&simule` lit le read model (foyer, contrats,
  prestations du mois, grilles applicables), passe les saisies au **domaine `libs/tarification/domain`**
  (politiques PSU/ABCM) puis **`consoliderCoutMoisFoyer`** ; `GET /api/couts/annuel?foyer&annee&simule`
  consolide sur l'année (transition crèche → école). Les **frais fixes ABCM** (cotisation + 1ʳᵉ
  inscription) sont rattachés à **septembre** (cohérent avec le domaine).
- **Contrat Pact** : consommateur `api-gateway` (`pacts/api-gateway-svc-tarification.json`, interaction
  « coût du mois », **octobre 2026**, cantine **CT-10 = 20 288 centimes**) ; provider `svc-tarification`
  vérifié (boot du bundle réel + base réelle via `TARIFICATION_DATABASE_URL`, `stateHandlers` qui
  amorcent le read model), **skip propre en local sans Postgres, bloquant en CI** (service
  `postgres-tarification`).

### 11.2 DoD Phase 6 (✅ validée)

- [x] `saisie → événements → GET coût` cohérent (eventual consistency) ; **CT-04/CT-10/CT-11/CT-20**
      reproduits via le chemin distribué complet (read model + domaine).
- [x] Consommateurs **idempotents** (durables, `processed_event` en transaction, `max_deliver`+backoff).
- [x] Fallback synchrone **résilient** (timeout/retry/circuit-breaker) si une projection est froide.
- [x] Contrat **Pact** (provider `svc-tarification`) vérifié, **bloquant en CI**.
- [x] `nx run-many -t lint typecheck test build` vert sur les **12 projets** ; `format:check` OK.

### 11.3 Écarts & choix concrets Phase 6

- **Table read-model `contrat` ajoutée** : `PlanningModifie` ne porte que `{contratId, mois, simule}` ;
  on projette donc l'identité (foyer/enfant/mode) reçue sur `ContratCree` dans une table locale `contrat`
  pour pouvoir rattacher les prestations du mois au bon foyer/enfant/mode.
- **Aucun événement émis** : Tarification est un **pur consommateur** au stage B — il n'émet pas
  `tarification.CoutRecalcule.v1`. La machinerie outbox du template (module + relais + son timer 2 s) a
  donc été **retirée** (`OutboxModule`/`OutboxRelay` supprimés) ; seule la **définition de table `outbox`
  reste** en `schema.ts` comme **infra latente** (pas de churn de migration) pour un futur recalcul publié.
- **Orchestration conservée dans le service app** : pas de lib `libs/tarification/application` créée — les
  cas d'usage (lecture read model + appel domaine + consolidation) vivent dans `apps/svc-tarification`
  (créer une lib `application` quasi vide casserait le seuil de couverture 100 % des libs domaine).
- **Optimisation d'idempotence `PlanningModifie`** : un court-circuit `dejaTraite(evt.id)` hors-transaction
  ACK un rejeu déjà projeté **avant** l'appel réseau de repli (économie de fetch) ; le dédup autoritatif
  reste l'insert transactionnel de `processed_event`.
- **Vérif Pact provider via `TARIFICATION_DATABASE_URL`** (≠ `DATABASE_URL`) → **4 bases en CI**.
  `docker compose up` et la vérif Pact provider exigent Docker/Postgres : **non rejouables hors CI**.

### 11.4 Point de départ Phase 7 — API Gateway / BFF (guide de reprise)

> Objectif : une **API orientée écran** pour le front (doc 05 → Phase 7). La gateway **agrège** les
> services (foyer + planification + tarification), porte l'auth, le CORS, le rate-limit et le versionnage.

**Réutiliser la gateway existante** (`apps/api-gateway`, déjà `/health` + façade Référentiel + **consommateur
Pact des quatre services**), **ET** les services aval déjà livrés :

- **Enrichir `apps/api-gateway`** (`type:app`, `context:gateway` — déjà câblé webpack + vitest + pacts
  consumer). Pas de nouveau service à créer ; on ajoute des contrôleurs de **façade/agrégation** qui
  appellent `svc-foyer` (3002), `svc-planification` (3004) et `svc-tarification` (3005) via clients REST
  (réutiliser le pattern de **client résilient** : timeout/retry/circuit-breaker de `svc-tarification`).
- **Parcours cible** : « créer foyer + contrats → lire le coût du mois » de bout en bout — la gateway
  orchestre l'écriture (Foyer/Planification) puis la lecture agrégée (Tarification `/api/couts`).
- **Transverses** : auth par **token**, **CORS**, **rate-limit**, versionnage **`/v1`** ; **OpenAPI**
  publié (`libs/contracts/openapi/`).
- **Contrats Pact** : les quatre `pacts/api-gateway-svc-*.json` sont **déjà** générés côté consumer ; en
  Phase 7 on **étend** les interactions consumer (nouveaux endpoints agrégés) et on garde les vérifs
  provider bloquantes en CI.
- **DoD** : parcours E2E API « créer foyer+contrats → lire coût du mois » vert ; contrats Pact à jour ;
  `nx run-many -t lint typecheck test build` vert (toujours **12 projets** tant qu'aucune nouvelle lib).

> ⚠️ Mêmes rappels qu'en §5/§8.8/§10.3/§11.3 (imports `.js`, tags `type/context`, domaine = TS pur,
> `**/node_modules` dans le `.eslintrc.json`, chemins `../../../` pour une lib imbriquée, exclusion
> couverture des fichiers purement types, `process.cwd()` dans les specs d'app — pas d'`import.meta`).
> Pact provider et `docker compose up` restent **CI-only** en local sans Docker (4 bases Postgres).

## 12. Phase 7 — API Gateway / BFF (✅ livré) + point de départ Phase 8

### 12.1 Phase 7 livrée — détail (conception de référence)

`apps/api-gateway` (`type:app`, `context:gateway`) a été **enrichi** (pas de nouveau service) en une
**API orientée écran** sous **`/api/v1`** qui agrège Foyer/Planification/Tarification. **Aucune
dépendance npm ajoutée** (auth/rate-limit/OpenAPI **faits main**, cohérent avec le circuit-breaker maison
de la Phase 6 et le risque d'un `pnpm install` hors-ligne). **12 projets**, run-many vert, `format:check` OK.

- **Clients REST résilients** (`src/clients/`) : `resilience.ts` **recopié de `svc-tarification`** puis
  généralisé (`fetchAvecTimeout(url, timeoutMs, init?)` pour POST/PUT avec corps). `FoyerClient`,
  `PlanificationClient`, `TarificationClient` (`@Injectable`, un `CircuitBreaker` par client, timeout
  2 s + 1 retry). **Différence clé vs Phase 6** : sur le chemin critique du BFF les clients
  **propagent** les erreurs (`executerResilient`, pas `executerOuRepli`) ; `src/bff/relais.ts` traduit
  `Error('HTTP <code>')` en `HttpException` de **même statut** (404 reste 404), sinon **502** (réseau/
  timeout/circuit ouvert). `ClientsModule` est **`@Global`**.
- **Contrôleurs d'agrégation** (`src/bff/`, `version: '1'`) : `POST /api/v1/foyers` **orchestre** la
  création du foyer **puis** de ses enfants (réponse `{ foyer, enfants }`) ; `GET /api/v1/foyers/:id`
  (foyer + enfants) ; `POST /api/v1/contrats` ; `PUT /api/v1/contrats/:id/plannings/:mois?simule=` ;
  `GET /api/v1/couts` & `/api/v1/couts/annuel`. Validation d'entrée **Zod** à la frontière BFF
  (`src/bff/bff.dto.ts`, erreurs `[{champ,message}]` homogènes aux services) ; le métier profond reste
  chez le service propriétaire.
- **Transverses (`src/security/`)** : `TokenAuthGuard` (Bearer ; **désactivé si `GATEWAY_TOKEN` absent**
  → confort dev) + décorateur `@Public()` (health/referentiel/openapi exemptés) ; `RateLimitGuard`
  (fenêtre glissante en mémoire, 429 ; **`@Optional()` sur l'horloge** sinon Nest tente de l'injecter →
  crash DI au boot). Les deux sont enregistrés en **`APP_GUARD`** (rate-limit **avant** auth) par
  `SecurityModule`. **CORS** + **versionnage URI** configurés via `src/app.config.ts` (**partagé**
  `main.ts` ↔ E2E pour éviter la dérive) : les transverses restent **neutres** (`/api/…`), seul le BFF
  porte `/v1` → compat docker/README et pacts existants inchangés.
- **OpenAPI publié** : document 3.1 **statique et versionné** dans `libs/contracts`
  (`gatewayOpenApiDocument`), servi par `GET /api/openapi.json` (`@Public()`). Pas de `@nestjs/swagger`.
- **Contrats Pact** : interactions **consumer** étendues aux **écritures** (`POST /api/foyers`,
  `POST /api/foyers/:id/enfants`, `POST /api/contrats`) en plus des lectures déjà publiées ; pacts
  régénérés sous `pacts/`. **Aucun nouveau `stateHandler` provider requis** (création sans précondition ;
  l'enfant réutilise l'état `un foyer de référence T3 existe`). Vérifs provider toujours **bloquantes en CI**.
- **Test E2E API** (`src/e2e/parcours.e2e.spec.ts`) : **démarre le bundle webpack réel** (`dist/main.js`)
  en sous-processus — **booter Nest in-process sous vitest casse l'injection** (esbuild n'émet pas les
  métadonnées de décorateurs, cf. §8.8) — et **simule les trois services aval** via un petit serveur HTTP
  local (`FOYER_URL`/`PLANIFICATION_URL`/`TARIFICATION_URL`). Joue « créer foyer+2 enfants (T3) → créer
  contrat cantine → lire le coût (CT-10 = 20 288 c.) », plus la validation 400, l'OpenAPI public et l'auth
  401/200. Le target `test` de la gateway gagne `dependsOn: ["^build","build"]` pour garantir le bundle ;
  **skip propre** si `dist/main.js` absent (sans build).

### 12.2 DoD Phase 7 (✅ validée)

- [x] Parcours **E2E API** « créer foyer + contrats → lire le coût du mois » vert de bout en bout.
- [x] Agrégation `/api/v1` (foyer/planification/tarification) via clients **résilients** ; auth token,
      CORS, rate-limit, versionnage `/v1` ; **OpenAPI publié**.
- [x] Contrats **Pact** consumer à jour (écritures incluses) ; vérifs provider **bloquantes en CI**.
- [x] `nx run-many -t lint typecheck test build` vert sur les **12 projets** ; `format:check` OK.

### 12.3 Écarts & pièges Phase 7

- **`@Optional()` obligatoire** sur tout paramètre de constructeur d'un provider Nest porteur d'une valeur
  par défaut non-injectable (l'horloge du `RateLimitGuard`) : sinon `UnknownDependenciesException` au boot.
  Bug **attrapé par l'E2E** (le bundle réel échouait au démarrage), invisible aux tests unitaires.
- **E2E = bundle spawné, jamais Nest in-process sous vitest** (métadonnées de décorateurs esbuild) — même
  raison que les vérifs Pact provider (§8.8). Le serveur aval simulé tient sur **un seul port** (chemins
  `/api/foyers` · `/api/contrats` · `/api/couts` disjoints) pointé par les trois `*_URL`.
- **`docker-compose`** : la gateway a reçu `FOYER_URL`/`PLANIFICATION_URL`/`TARIFICATION_URL` (noms de
  service internes) + `depends_on` des trois services, sinon le BFF ne joint personne dans la pile.
- **Aucune nouvelle dépendance** : décision assumée (faits main) ; si un futur lot veut Swagger/Throttler,
  prévoir le `pnpm install` (réseau) et re-vérifier les frontières de modules.

### 12.4 Point de départ Phase 8 — Interface web (guide de reprise)

> Objectif : l'**outil web utilisable au quotidien** (doc 05 → Phase 8). Le front **ne parle qu'au BFF**.

- **Créer `apps/web`** (front React PWA). Cible le BFF `http://localhost:3000/api/v1` **uniquement** —
  jamais les services en direct. La **source de vérité des contrats** est l'OpenAPI publié
  (`GET /api/openapi.json`, ou `gatewayOpenApiDocument` dans `libs/contracts`) : générer/typer le client
  HTTP depuis là. Auth : en-tête `Authorization: Bearer <GATEWAY_TOKEN>` quand le jeton est défini.
- **Écrans** (doc 05 §Phase 8) : saisie foyer/contrats, **calendrier mensuel** par enfant et par mode
  (FullCalendar), panneau **coût du mois** (détail par mode) + **vue annuelle** + **mode simulation**
  (`?simule=true`, delta €). **PWA installable**.
- **Endpoints BFF disponibles** : `POST /api/v1/foyers` (+ enfants), `GET /api/v1/foyers/:id`,
  `POST /api/v1/contrats`, `PUT /api/v1/contrats/:id/plannings/:mois?simule=`, `GET /api/v1/couts`,
  `GET /api/v1/couts/annuel`. **Réutiliser** le pattern de client résilient si un BFF-for-front a besoin
  d'agréger davantage.
- **DoD** : E2E **Playwright** « planifier un mois → lire le coût consolidé » ; PWA installable ;
  run-many vert.

> ⚠️ Mêmes rappels qu'en §5/§8.8/§10.3/§11.3/§12.3. Le front est un **nouveau `context:web`** : respecter
> les frontières (`libs/contracts` seule passerelle). Vérifier le **port hôte libre** (3000 = gateway,
> 3001 referentiel, 3002 foyer, 3003 **Grafana**, 3004 planification, 3005 tarification).

## 13. Phase 8 — Interface web (✅ livré) + point de départ Phase 9

### 13.1 Phase 8 livrée — détail (conception de référence)

`apps/web` (`type:app`, `context:web` — **nouveau contexte**) : front **React 18 + Vite 6 PWA**,
**port 4200**, qui ne parle **qu'au BFF** (`/api/v1`). **13 projets**, run-many vert, `format:check` OK,
E2E Playwright vert.

- **Câblage 100 % manuel** (pas de générateur Nx) : `@nx/react` absent et le générateur `@nx/web`/
  `@nx/vite` émet une `eslint.config.mjs` **flat** incompatible avec le `.eslintrc.json` legacy du dépôt
  (cf. §4/§5, ADR-0003). On a recopié le pattern de `apps/api-gateway` : `.eslintrc.json` (+`**/node_modules`
  dans `ignorePatterns`), `tsconfig.*`, et **targets Nx explicites** dans `package.json`
  (`build`/`serve`/`dev`/`preview` = `vite …`, `typecheck` = `tsc --noEmit -p tsconfig.app.json`,
  `test` = `vitest run`, `e2e` = `playwright test`) pour **éviter toute collision d'inférence** entre
  `@nx/js/typescript` et `@nx/vite` sur un projet qui a à la fois un `tsconfig` et un `vite.config`.
- **Écart TS clé** : `moduleResolution: "bundler"` + `module: "esnext"` + `jsx: "react-jsx"` overridés
  dans `tsconfig.app.json`/`tsconfig.spec.json` (le `tsconfig.base.json` impose `nodenext`, requis par les
  apps NestJS CJS). `composite/emitDeclarationOnly` mis à `false` côté web (typecheck `--noEmit`).
  **`import.meta.env` est idiomatique ici** (ESM/Vite) — l'interdit `import.meta` du §8.8 ne vise que les
  apps NestJS CJS.
- **Frontière** : ajout de `{ sourceTag: "context:web", onlyDependOnLibsWithTags: ["context:web",
"context:shared"] }` dans le `.eslintrc.json` racine ; `apps/web` ajouté aux `references` du
  `tsconfig.json` racine. Le front **n'importe aucune lib runtime** : les **types BFF sont écrits à la
  main** dans `src/types/bff.ts` (miroir de l'OpenAPI + DTO `svc-planification`), pas de codegen.
- **Deps ajoutées** (dans `apps/web/package.json`) : `react`/`react-dom` 18, `react-router-dom` 6,
  `@fullcalendar/{react,core,daygrid,timegrid,interaction}` ~6.1.20 (prod) ; `@vitejs/plugin-react`,
  `vite-plugin-pwa` **0.21** (compat Vite 6 — **ne pas** passer en 1.x sans revérifier), `@types/react*`,
  `@testing-library/*`, `jsdom`, `@playwright/test` (dev). `vite`/`vitest` restent **épinglés** (rolldown
  KO sous Windows, ADR-0003).
- **Architecture front** : routeur `react-router` (`/foyers/new`, `/foyers/:foyerId/contrats|planning|couts`).
  Socle partagé : `api/client.ts` (`fetch` + `Authorization: Bearer` si `VITE_GATEWAY_TOKEN`, `ApiError`),
  `hooks/useAsync` + `useFoyer` (AbortController + reload), `utils/{money,dates,store}` (centimes→€, calendrier,
  persistance locale `foyerId`/contrats). **État = hooks + `fetch`, zéro lib de state.**
- **Écrans** (un dossier = un agent au build, frontières figées par le scaffold) : `src/foyer/`
  (FoyerFormPage, ContratsPage, ContratForm union-par-mode), `src/planning/` (PlanningPage à onglets
  enfant/mode, CalendrierCreche + CalendrierAbcm FullCalendar, `usePlanning` avec **debounce 800 ms**),
  `src/couts/` (PanneauCoutMois + delta de simulation, CoutsAnnuelsPage). Écriture de planning → `PUT`
  → incrément `planningVersion` → re-fetch du coût. **Simulation** = `?simule=true` (fetch réel + simulé
  en parallèle, delta €).
- **Contrats ↔ enfant** : `CreerContrat.enfant` et `ContratVue.enfant` sont le **prénom** (pas l'id) ; le
  planning filtre les contrats par **prénom** (corrigé en intégration — piège typique).
- **PWA** : `vite-plugin-pwa` (`registerType: 'autoUpdate'`), `manifest` + icône SVG, SW Workbox généré au build.
- **E2E Playwright** (`apps/web/e2e/parcours.e2e.spec.ts`) : **BFF mocké par interception réseau**
  (`page.route('**/api/v1/**')`) → **offline et déterministe**, le `webServer` ne sert que le front (vite).
  Joue « créer foyer → contrat cantine → planning → lire le coût (CT-10 = 20 288 c) + écrire le planning (PUT) ».
- **Ops** : `apps/web/Dockerfile` (build node → **nginx:alpine**, SPA `try_files` + **proxy `/api` →
  `api-gateway:3000`**, même origine donc pas de CORS) ; service `web` dans `docker-compose.yml`
  (`4200:80`, `depends_on api-gateway`) ; job CI **`e2e-web`** (`needs: ci`, `playwright install --with-deps
chromium`, `nx e2e web`).

### 13.2 DoD Phase 8 (✅ validée)

- [x] Parcours **E2E Playwright** « créer foyer + contrat → planifier un mois → lire le coût consolidé » vert.
- [x] Saisie foyer/contrats ; **calendrier mensuel** FullCalendar par enfant/mode ; panneau **coût du
      mois** + **vue annuelle** + **mode simulation** (delta €) ; **PWA installable**.
- [x] Front consomme **exclusivement le BFF** (`/api/v1`) ; auth Bearer optionnelle.
- [x] `nx run-many -t lint typecheck test build` vert sur les **13 projets** ; `format:check` OK.

### 13.3 Pièges & choix concrets Phase 8

- **Scaffold manuel obligatoire** (config ESLint legacy) — voir 13.1. Targets Nx **explicites** pour ne
  pas dépendre de l'inférence `@nx/vite`/`@nx/js`.
- **`exactOptionalPropertyTypes`** : ne jamais passer `prop={x ? v : undefined}` à un composant tiers
  (ex. `dateClick` de FullCalendar) → utiliser le **spread conditionnel** `{...(x ? { prop } : {})}`.
- **Tests `.tsx` en français** : apostrophes (`d'`, `l'`) à mettre en **guillemets doubles** sinon erreur
  de parsing ESLint ; `new Promise(() => {})` (loading) viole `no-empty-function` → `() => undefined`.
- **Playwright** : installer le binaire `chrome-headless-shell` (`playwright install chromium-headless-shell`),
  pas seulement `chromium` ; lancer `pnpm exec playwright` **depuis `apps/web`** (deps isolées).
- **Contrat : les 7 jours sont obligatoires** (validé en conditions réelles, invisible au mock E2E) :
  `svc-planification` valide `semaineType`/`semaineAbcm` comme des **Record complets** des 7 jours
  (`[]` / `{}` pour un jour sans garde/inscription) → un envoi partiel renvoie 400 « expected
  array/object, received undefined ». `ContratForm` construit donc toujours les 7 jours au submit.
- **Limites assumées** : le BFF n'expose pas de **liste de contrats** → conservés en `sessionStorage`
  (avec leur semaine-type pour piloter le calendrier) ; jours fériés non exposés par le BFF → non grisés
  au calendrier (le backend les exclut au calcul). À reprendre en Phase 9 si besoin.

### 13.4 Point de départ Phase 9 — Durcissement & exploitation (guide de reprise)

> Objectif : **version exploitable** (doc 05 → Phase 9). Résilience, observabilité, déploiement.

- **Résilience / chaos léger** : couper un service aval et vérifier la **dégradation propre** (le BFF
  renvoie déjà 502 sur réseau/timeout/circuit ouvert ; vérifier le rendu d'erreur côté `apps/web`).
- **Observabilité** : dashboards Grafana (latence, erreurs, **lag d'événements** JetStream), alertes de base.
- **Exploitation** : sauvegardes par base Postgres, **runbook de déploiement**, (option) manifests K8s.
- **Front** : **export CSV/PDF** du récap, **a11y & responsive**, éventuelle persistance locale (IndexedDB)
  des contrats (cf. limite 13.3), exposer le **recalcul RFR en cours d'année** (`Q-05`, déjà côté Foyer).

> ⚠️ Mêmes rappels qu'en §5/§8.8/§10.3/§11.3/§12.3/§13.3. Pour `apps/web` : config câblée à la main,
> `moduleResolution: bundler`, `import.meta.env` OK (ESM), E2E = BFF mocké (offline). Vérifier le **port
> hôte libre** avant d'en figer un nouveau.

### 13.5 Validation en conditions réelles (session 2026-06-04) + backlog Phase 9

**Fait** : pile complète lancée (`docker compose up --build`, 15 conteneurs) et **parcours UI piloté
dans un vrai navigateur** (Playwright) contre les vrais services → foyer **tranche 3** (svc-foyer réel),
contrats, calendrier FullCalendar, coût calculé par svc-tarification (juin ≈ 1 201 € ; sept. ≈ 1 617 €
avec frais fixes 436 € en septembre). **3 bugs corrigés** que le mock E2E ne pouvait pas révéler :

- `79afcc6` — front : envoyer les **7 jours** dans `semaineType`/`semaineAbcm` (cf. §13.3).
- `10d5f8d` — front : **barre de navigation réactive** (`useLocation` dans `Entete`) ; sinon les liens
  Contrats/Planning/Coûts n'apparaissaient jamais après création du foyer.
- `c7993ba` — **planification : `heures_annuelles_contractualisees` en `double precision`** (était
  `integer`, rejetait 885,5/831,5 → 500) + migration `0001_heures_fractionnaires`.

**Backlog Phase 9 (découvert en validation, à traiter)** :

1. **Édition / suppression de contrat absente** : il n'existe que `POST /contrats` et
   `PUT /contrats/:id/plannings/:mois`. Pas de `PUT/PATCH/DELETE /contrats/:id` (ni svc-planification, ni
   BFF, ni UI) → on ne peut **pas modifier ni supprimer** un contrat créé (seul le planning mensuel est
   éditable). À ajouter : endpoint update/delete (+ événement `ContratModifie` / cascade planning), relais
   BFF `/api/v1/contrats/:id`, bouton Modifier/Supprimer + `ContratForm` en mode édition, pacts.
2. **Prestations non filtrées par période de validité** ⚠️ : `valideDu`/`valideAu` du contrat sont
   **ignorés** lors de la génération mensuelle → en juin la cantine de Zoé (valide dès sept.) apparaît,
   et en sept. la crèche de Mia (finie le 31/07) apparaît encore. **Fausse la vue annuelle et la
   transition crèche→école (doc 02 §8).** Correctif **domaine Planification/Tarification** : ne générer
   aucune prestation pour un mois hors `[valideDu, valideAu]`.

**Env Docker (Windows)** : si Docker Desktop refuse de démarrer (« Secrets Engine », socket
`%LOCALAPPDATA%\docker-secrets-engine\engine.sock` corrompu, insupprimable même après reboot),
**renommer le dossier `docker-secrets-engine`** (ex. `.broken`) — Docker en recrée un sain au démarrage.

**Seed de démo** : un script console (créer foyer + 5 contrats Mia/Zoé avec les valeurs de
référence de doc 02 §7) a servi à peupler l'app ; valeurs : crèche Mia 885,5 h-an / Zoé 831,5 h-an (7 mensualités,
semaine Lun/Mer/Ven), ABCM Zoé dès 2026-09-01 (cantine Lun/Mer/Ven, péri, ALSH au calendrier).

## 14. Phase 9 — Durcissement & exploitation (✅ réalisée)

> Réalisée en une session multi-agents (2026-06-04). **`nx run-many -t lint typecheck test build` vert
> sur les 13 projets** + `format:check` OK. Aucune nouvelle dépendance npm (cohérent avec les Phases 7/8 :
> tout fait main, pas de `pnpm install` requis). La **validation runtime** (chaos réel, dashboards Grafana
> live, vérif Pact provider des nouvelles interactions CRUD, `docker compose up`) reste **CI/Docker** —
> non rejouable hors Docker, comme aux phases précédentes.

### 14.1 Bugs backlog corrigés (découverts en validation réelle §13.5)

- **#2 — Prestations filtrées par période de validité** (correctness ⚠️). Au niveau **domaine** : méthode
  publique `couvreMois(mois): boolean` sur `ContratCreche` **et** `InscriptionAbcm` (vraie si ≥ 1 jour du
  mois est dans `[valideDu, valideAu]`). Un mois **entièrement hors période** ne génère plus de prestation :
  `genererPrestationsMois` (crèche) court-circuite et renvoie une prestation neutralisée avec
  **`heuresAnnuellesContractualisees = 0`** — point clé, car la mensualité PSU est **lissée**
  (`heuresAnnuelles / nbMensualites`) et **indépendante** des heures réservées : il fallait annuler les
  heures _annuelles_, pas seulement les réservées. ABCM : `ConfigInscriptionAbcm` gagne `valideDu?/valideAu?`
  (optionnels → rétro-compatibles CT-10/11/12), `joursFacturables` et la boucle ALSH filtrent désormais par
  période. **Aucune modification de `tarification-domain`/`svc-tarification`** : les quantités nulles donnent
  un coût nul (`exigerNombreNonNegatif(0)` OK, `nbMensualites` conservé). `planification-domain` : **85 tests,
  100 % de couverture** ; CT-01..20 toujours verts. Corrige la vue annuelle et la transition crèche→école
  (Mia crèche finie 31/07 n'apparaît plus en août/sept. ; Zoé cantine n'apparaît plus avant sept.).
- **#1 — Édition / suppression de contrat** (de bout en bout). Voir 14.2.

### 14.2 Édition / suppression de contrat (CRUD transverse)

- **`libs/contracts`** : `planification.ContratModifie.v1` (payload `{contratId, foyerId, enfant, mode,
valideDu, valideAu}`) et `planification.ContratSupprime.v1` (`{contratId}`) via `integrationEventSchema`
  (+ `asyncapi/planification.md`). Stream `PLANIFICATION`, sujets `planification.>`.
- **`apps/svc-planification`** : `PUT /api/contrats/:id` (200, valide via domaine, **invalide les
  `planning_mois`** car mode/dates peuvent devenir incohérents, émet `ContratModifie` dans la transaction,
  404 sinon) et `DELETE /api/contrats/:id` (204, supprime `planning_mois` puis `contrat`, émet
  `ContratSupprime`, 404 sinon). **Pas de migration** (schéma inchangé). Routes `:id` et
  `:id/plannings/:mois` coexistent (templates distincts, pas de shadowing — l'E2E gateway passe toujours).
- **`apps/api-gateway` (BFF)** : relais `PUT`/`DELETE /api/v1/contrats/:id` (clients résilients
  timeout/retry/circuit-breaker ; `relais.ts` → 404 reste 404, réseau → 502). Validation Zod d'entrée.
- **`apps/web`** : `ContratsPage` boutons **Modifier** (ouvre `ContratForm` **pré-rempli** en mode édition →
  `PUT`) et **Supprimer** (confirme via `window.confirm` → `DELETE`, retrait local `sessionStorage`).
  `ContratForm` gère le mode édition (reconstruit coches/plages/ABCM/heures/dates) ; **les 7 jours toujours
  construits au submit** (§13.3). Erreurs via `messageErreur` (cf. 14.4).
- **`apps/svc-tarification` (read model)** : le consommateur du stream PLANIFICATION traite désormais
  `ContratModifie` (upsert identité `contrat` + réaligne `prestation_mois`) et `ContratSupprime`
  (delete `prestation_mois` + `contrat`), **idempotents** (`processed_event` dans la transaction ;
  rejeu `ContratSupprime` = no-op).
- **Pacts** : interactions **consumer** (`api-gateway`) `PUT`/`DELETE` ajoutées à
  `pacts/api-gateway-svc-planification.json` ; `stateHandler` provider correspondant
  (`un contrat de garde modifiable existe`). Vérif provider **CI-only** (skip propre sans Postgres local).

### 14.3 Observabilité

- **Dashboards Grafana** provisionnés (JSON versionnés sous `docker/grafana/dashboards/`, provider
  `docker/grafana/provisioning/dashboards/dashboards.yaml`) : (01) vue d'ensemble services basée sur les
  métriques **réelles** `otelcol_*` (`otel-collector:8888`) + `up` ; (02) latence & traces via **Tempo**
  (explorateurs TraceQL) ; (03) **lag JetStream** via un service **`nats-exporter`**
  (`prometheus-nats-exporter`) ajouté au `docker-compose.yml` + scrapé par Prometheus
  (`gnatsd_consumer_num_pending` des durables `tarification-*`).
- **Alertes** : `docker/prometheus/alerts.yml` (référencé par `rule_files:` dans `docker/prometheus.yml`) —
  `ServiceDown`, drops/refus de spans OTel, `JetStreamLag` (croissant/critique), redéliveries élevées,
  `NatsExporterDown`.
- **Honnêteté d'instrumentation** (`docs/exploitation/observabilite.md`) : **aucun service NestJS n'expose
  `/metrics`** → pas de métriques RED applicatives en time-series sans soit `@willsoto/nestjs-prometheus`,
  soit le span-metrics generator de Tempo (remote-write, zéro code) — documenté en **TODO**, de même
  qu'Alertmanager, Loki/Promtail et `postgres_exporter`.

### 14.4 Front (export, a11y, erreurs)

- **Export CSV** fait main (`apps/web/src/couts/export.ts`, sans dépendance) : récap coût du mois + vue
  annuelle, séparateur `;` + CRLF + BOM UTF-8 (Excel fr-FR), montants € via l'util `money`, colonnes
  réel/delta en simulation. **Export PDF** via `window.print()` + feuille `@media print` (aucune lib jsPDF).
- **a11y & responsive** : `aria-label`, `role="alert"`, `<caption>`, focus clavier visible, media queries
  mobile/tablette (≤ 768 px) dans `styles.css`.
- **Rendu d'erreur réseau** : `apps/web/src/utils/erreurs.ts` → `messageErreur(e)` mappe `ApiError`/`Error`/
  `TypeError` en message FR (502 & 5xx → « Service indisponible, réessayez… » ; 404/409/4xx spécifiques),
  appliqué dans `useAsync`/`usePlanning`/panneaux coût (avant : « HTTP 502 » brut). Bouton « Réessayer » sur
  la vue annuelle. **Résilience/chaos** : le chemin BFF→front est prêt (502 propre) ; la **vérif chaos réelle
  (couper un service aval) reste à jouer sous Docker**.

### 14.5 Exploitation (sauvegardes + runbook)

- **Scripts** `scripts/` : `backup-all.{ps1,sh}` (boucle sur les 4 bases via `docker compose exec` +
  `pg_dump`, dossier horodaté, formats custom/plain) et `restore-one.{ps1,sh}` (paramétré par base + dump,
  détection de format par extension, `--clean` derrière confirmation/`-Force`). PowerShell **et** bash.
- **Docs** `docs/exploitation/` : `runbook-deploiement.md` (prérequis, `docker compose up --build`, ordre
  des `depends_on`/healthchecks, santé `GET /api/health`, migrations au boot, arrêt/`-v` destructif,
  rollback, pièges Windows : disque C: plein + Secrets Engine corrompu) et `sauvegardes.md` (4 volumes,
  fréquence, restauration, test de restauration).

### 14.6 Hors périmètre / restes

- **Manifests Kubernetes** : optionnels (doc 05 §Phase 9) — **non livrés** (assumé).
- **Validation runtime** : chaos réel, dashboards Grafana live, vérif Pact provider des interactions CRUD,
  `docker compose up` complet → **CI/Docker** (non rejouables hors Docker, comme aux phases précédentes).
- **TODO observabilité** (cf. 14.3) : `/metrics` applicatif ou Tempo span-metrics, Alertmanager, Loki,
  `postgres_exporter`.
- **Méthode** : les 5 chantiers ont été menés par **agents parallèles sur fichiers disjoints** (bug #2
  domaine, observabilité, ops, front) puis un agent **CRUD transverse** en second (svc-planification +
  contracts + BFF + web + tarification + pacts), suivi d'un `run-many` d'intégration centralisé.

### 14.7 DoD Phase 9

- [x] **Résilience** : dégradation propre côté BFF (502) + **rendu d'erreur lisible côté front** ; chaos
      réel à valider sous Docker.
- [x] **Observabilité** : dashboards Grafana (latence/erreurs/**lag JetStream**) + alertes Prometheus de base.
- [x] **Exploitation** : sauvegardes par base + **runbook de déploiement** (K8s optionnel non livré).
- [x] **Front** : export **CSV/PDF** du récap + **a11y & responsive**.
- [x] **Bugs backlog** : #2 période de validité (domaine, 100 %) + #1 CRUD contrat (de bout en bout).
- [x] `nx run-many -t lint typecheck test build` vert sur les **13 projets** ; `format:check` OK.

## 15. Phase 10 — Navigation & interface UX (✅ réalisée)

> Réalisée en une session multi-agents (2026-06-04) selon le découpage en lots de la **doc 08**
> (spec **doc 07**). **Front-only** (`apps/web/src`) : aucune modification de service/domaine/contrat
> d'API, **aucune dépendance npm** ajoutée. **`nx run-many -t lint typecheck test build` vert sur les
> 13 projets**, **136 tests web**, **E2E Playwright vert** (parcours créer foyer → contrat → planning →
> coût, inchangé). Méthode : Lot 1 (fondation) d'abord, puis **lots 2→6 par agents parallèles sur
> fichiers disjoints**, puis intégration centralisée (Lot 7).

### 15.1 Lot 1 — Fondation (design system & primitives)

- **Tokens CSS** (`styles.css`, `:root`) : couleurs de mode (`--mode-creche/cantine/periscolaire/alsh`),
  violet `#7c3aed` + ambre `#b45309`, échelle d'espacement `--esp-1..6`, tailles de titres `--h1/h2/h3`.
- **Classes & états** : `.btn:hover/:active` + transition, `.app-header a.active`, `.onglets`/`.onglet`/
  `.onglet.actif` (flex-wrap), `.modal-overlay`/`.modal`, `.badge`/`.badge-simulation`, `.carte` (ombre),
  `.table-couts-wrap`, `@keyframes spin`/`.spinner`, `.etat-vide`, `.skip-link` (visible au focus),
  `.panneau-cout` (`position:sticky`) — la classe morte est désormais définie (EX-16).
- **Primitives** (`apps/web/src/ui/`) : `EtatVide`, `Modale` (focus-trap + restauration focus + Échap +
  clic overlay, `role="dialog"`/`aria-modal`/`aria-labelledby`), `Badge`, `StatutSauvegarde`, `Spinner`
  (`role="status"`). **Hook** `useTitrePage`. **Utils** : `LIBELLES_MODE` accentué unique
  (`utils/libelles.ts`), `couleurDuMode` (`utils/couleurs.ts`, lit les tokens), `formaterDateFr`
  (`utils/dates.ts`). Toutes testées (rôles ARIA, focus-trap, Échap).

### 15.2 Lots 2→6 — Pages & composants (agents parallèles, fichiers disjoints)

- **Lot 2 — Coquille** (`App.tsx`, `hooks/useFoyer.ts`, `utils/store.ts`) : `foyerId` **source de vérité
  URL** (`useMatch`, header dérivé de la route, `localStorage` lu seulement par `/`) ; `<NavLink>` actif +
  `aria-current` ; **vraie 404** (`PageIntrouvable` au lieu de `<Navigate to="/">`) ; **`<GardeFoyer>`**
  route parente `/foyers/:foyerId` → `EtatVide` distinct sur **404** (« Foyer introuvable » + CTA) vs
  **5xx** (« Service indisponible » + Réessayer), via `useFoyer.erreurKind` (`'introuvable'|'indisponible'`) ;
  `<nav aria-label>` + **skip-link** vers `<main id="contenu">`. `store.ts` : exports conservés + ajout
  `effacerFoyerId`.
  > **Correctif 2026-06-06** : `<GardeFoyer>` **persiste** désormais le foyer au chargement réussi
  > (`setFoyerId`) — l'arrivée par **lien direct** « colle », et `/` y revient sans toucher au
  > `localStorage` à la main — et **oublie** (`effacerFoyerId`) un foyer **mémorisé** devenu introuvable
  > (uniquement si c'est celui mémorisé, pour ne pas effacer un bon foyer en consultant l'URL d'un autre).
  > Le `localStorage` reste **lu** seulement par `/` ; il est désormais **écrit** au seul chargement réussi.
  > Sans ça, un `foyerId` périmé (après purge des bases `docker compose down -v`) laissait l'UI bloquée.
- **Lot 3 — Planning** (`planning/PlanningPage.tsx`) : `mois`/`enfant`/`mode` **dans l'URL**
  (`useSearchParams`, restaurés au retour navigateur) ; onglets `role="tab"`/`aria-selected` ;
  **`EtatVide`** + CTA « Créer un contrat » ; `LIBELLES_MODE` + badge SIMULATION ; `useTitrePage('Planning')`.
  `usePlanning.ts` inchangé. **Props des composants enfants inchangées.**
- **Lot 4 — Calendriers** (`planning/CalendrierCreche.tsx`, `CalendrierAbcm.tsx`) : overlays → **`Modale`**
  (EX-09) ; **alternative clavier** à `dateClick` (liste de jours `<fieldset>` + bouton « Saisir » par
  ligne, parcours absence/ALSH 100 % clavier, EX-08) ; couleurs via `couleurDuMode` (tokens) ; dates via
  `formaterDateFr`, statut via `StatutSauvegarde`. `dateClick` passé en **spread conditionnel**. **Props
  publiques inchangées.**
- **Lot 5 — Formulaires** (`foyer/ContratForm.tsx`, `FoyerFormPage.tsx`, `ContratsPage.tsx`) :
  `aria-invalid` + `aria-describedby` champ↔message, `aria-required` + astérisque ; **succès** `role="status"`
  après create/edit/delete ; **défauts démo** (Mia/Zoé/montants) derrière flag `!import.meta.env.PROD`
  (vides en prod) ; `scope="col"`/`<th scope="row">` sur le tableau ABCM ; `key` stable par enfant ;
  titres de page. **7 jours au submit + mode édition + CRUD `window.confirm` préservés.**
- **Lot 6 — Coûts** (`couts/CoutsAnnuelsPage.tsx`, `PanneauCoutMois.tsx`) : tableau `.table-couts-wrap`
  (overflow-x + min-width) + `scope` ; `<h1>` « Coûts annuels » (pas de saut de niveau) ; `LIBELLES_MODE`
  (plus de `CRECHE_PSU` brut) + `formaterDateFr` + badge SIMULATION ; **préfixes signés ± conservés** (pas
  d'info par la couleur seule) ; `Spinner`/`aria-live`. **Props de `PanneauCoutMois` inchangées.**

### 15.3 Lot 7 — Polish & intégration

- `.skip-link` ajouté à `styles.css` (masqué hors focus, visible au focus clavier) — la seule classe
  référencée (Lot 2) qui restait à styler.
- Intégration centralisée : `nx run-many -t lint typecheck test build` **vert sur les 13 projets**
  (`--skip-nx-cache` côté web), **136 tests web**, **E2E Playwright vert** (routes nestées sous
  `/foyers/:foyerId` → mêmes chemins, mock BFF inchangé).

### 15.4 Écarts & pièges Phase 10

- **Travail parallèle sur arbre partagé** : les lots 2→6 ont édité des **fichiers strictement disjoints** ;
  chaque agent n'a vérifié **que ses propres specs** (`vitest run <fichiers>`), jamais une cible nx globale
  (lint/typecheck/test/build sont **project-wide** et auraient vu les fichiers à demi-écrits des autres
  agents) → **un seul `run-many` d'intégration centralisé** à la fin (même méthode qu'en §14.6).
- **`exactOptionalPropertyTypes`** : props optionnelles passées en **spread conditionnel**
  `{...(x ? { prop } : {})}` (FullCalendar `dateClick`, `aria-describedby`) — jamais `prop={x ? v : undefined}`.
- **Défauts démo** derrière `import.meta.env.PROD` : en dev/test `PROD=false` → défauts conservés (tests
  existants verts) ; en build prod les champs démarrent vides.
- **`commitlint`** : corps de message **≤ 100 caractères/ligne** (sinon `body-max-line-length` bloque le commit).

### 15.5 DoD Phase 10

- [x] **Aucune impasse** : 404 réelle, foyer introuvable (404 vs 5xx), états vides à CTA (EX-01/03/07).
- [x] **Parcours clavier complet** : saisie absence/ALSH au clavier, modales accessibles, onglets/landmarks
      (EX-08/09/10) ; validation liée champ↔erreur + succès annoncé (EX-11/12).
- [x] **Cohérence** : `LIBELLES_MODE` accentué unique, dates `formaterDateFr`, aucun mode brut (EX-13) ;
      tokens & états CSS, primitives par classes (EX-14) ; responsive tableaux/onglets (EX-15) ; finitions
      `scope`/`key`/classe morte/`skip-link` (EX-16).
- [x] **Source URL** : `foyerId`/`mois`/onglets deep-linkables, NavLink actif, titres de page (EX-02/04/05/06).
- [x] **Non-régression** : `nx run-many -t lint typecheck test build` vert sur les **13 projets** ;
      **E2E Playwright** vert ; calcul & contrats d'API **inchangés**.

## 16. Audits d'évaluation (2026-06-04) → Phases 11 & 12 (à réaliser)

Deux campagnes d'**agents d'évaluation en lecture seule** ont été menées le 2026-06-04 pour mesurer
l'atteinte de l'objectif d'architecture (ADR-0001) et la qualité d'usage. Elles **déclenchent**
deux nouvelles phases planifiées (specs + plans rédigés, **implémentation à venir**).

### 16.1 Audit architecture — micro-services & découplage (2 agents)

- **Constat** : architecture micro-services **authentique** (4 services + gateway, base-par-service,
  NATS JetStream, outbox transactionnel, idempotence, résilience, Pact bloquant, OTel/Tempo/Grafana).
  **Maturité 84/100** ; **qualité du découplage 92/100** ; **zéro dépendance circulaire** ; SDP
  respecté ; frontières Nx en `error` **sans contournement**.
- **Découplage** : **Fort** sur le code et les données ; **Moyen** sur le runtime et les contrats.
- **Freins au « découplage maximum »** : couplage de contrat **centralisé** (`libs/contracts`,
  fan-in 5) ; versioning `.v1` **cosmétique** ; livraison **coordonnée** (`0.0.1` figé, CI
  mono-pipeline) ; repli sync tarif→planif **non instrumenté** ; `apps/web` **non typé** contre
  l'OpenAPI ; `resilience.ts` **dupliqué** ; Dockerfile générique ; règles ESLint mortes.
- ➡️ **Phase 11** : [ADR-0004](adr/0004-decentralisation-des-contrats.md) (décentralisation des
  contrats), [doc 09](09-spec-decouplage-microservices.md) (DEC-01..10), [doc 10](10-plan-implementation-decouplage.md)
  (7 lots, A fondation contrats → B-F parallèles → G intégration). **Comportement gelé, pacts inchangés.**

### 16.2 Audit utilisabilité — ISTQB CT-UT (1 agent)

- **Cadre** : ISO 9241-11 (efficacité/efficience/satisfaction), heuristiques de Nielsen, WCAG 2.1.
- **Constat** : socle **mature** (zéro impasse, modale/formulaires accessibles, alternative clavier
  au calendrier, design system cohérent). **Score 82/100** ; **WCAG A atteint, AA quasi atteint**.
- **Écarts structurants AA** : pattern `tablist` **incomplet** (`PlanningPage`) ; **pas de focus/
  annonce** au changement de route (`App.tsx`).
- **Irritants** : `window.confirm()` natif vs `Modale` ; message « Données invalides » non
  actionnable ; absences **perdues** au changement de mois ; liaison erreur↔champ manquante
  (`nbEnfantsACharge`) ; boutons « Retirer » sans nom unique ; sigles métier non explicités.
- **Bug fonctionnel** repéré : `ContratForm.tsx` (AbcmEditor) — colonne « Inscrit ALSH » écrivant
  dans le champ `cantine` (→ UT-10).
- ➡️ **Phase 12** : [doc 11](11-spec-accessibilite-ct-ut.md) (UT-01..10, sévérités Nielsen),
  [doc 12](12-plan-implementation-accessibilite.md) (7 lots, 1 fondation a11y → 2-6 parallèles →
  7 intégration + axe-core). **Front-only, objectif WCAG 2.1 AA.**

### 16.3 Méthode de reprise (identique aux Phases 9 & 10)

Les deux plans réutilisent la **méthode d'orchestration éprouvée** : un **lot fondation
séquentiel** d'abord (contrats pour P11 ; primitives a11y pour P12), puis des **lots parallèles à
fichiers strictement disjoints** confiés à des agents indépendants, puis une **intégration
centralisée** (un seul `run-many` final — les cibles nx sont project-wide et verraient les fichiers
à demi-écrits des autres agents). Chaque plan fournit ses **prompts de lancement** prêts à coller
(doc 10 §5, doc 12 §5). Ordre recommandé : **Phase 11 avant Phase 12** n'est pas imposé — les deux
sont **indépendantes** (P11 backend/infra + contrats ; P12 front-only `apps/web`), donc
**parallélisables entre elles**.

## 17. Phase 11 réalisée — Découplage & maturité micro-services

> ✅ **Réalisée le 2026-06-05** par **agents parallèles** (méthode §16.3) : Lot A fondation seul →
> Lots B-F en parallèle sur fichiers disjoints → intégration centralisée. **`nx run-many -t lint
typecheck test build` vert sur les 17 projets** (13 + 4 libs de contrat − 1 ancienne + 1 lib
> `resilience`). **Comportement gelé : pacts inchangés**, E2E API vert. Branche `feat/phase-11-decouplage`.

### 17.1 Lot A — Segmentation des contrats (DEC-01, DEC-10)

`libs/contracts` (monolithe, fan-in 5) **éclatée** en 4 libs câblées **à la main** (pas le
générateur Nx) : `@creche-planner/contracts-kernel` (`context:shared` — enveloppe
`IntegrationEvent`, DTO santé, OpenAPI gateway) + `contracts-foyer`/`-referentiel`/`-planification`
(`context:<X>` — événements du contexte). Imports réécrits dans les 4 services + gateway. La règle
`@nx/enforce-module-boundaries` interdit désormais par **tag** qu'un service tire les contrats d'un
contexte non consommé (preuve figée : `apps/svc-foyer/src/contract/frontieres.boundary.spec.ts`).
Fan-in de contrat **5 → 2 par contexte**. Contraintes ESLint mortes `type:application` retirées
(DEC-10). `svc-tarification` (consommateur transverse) dépend des 3 contrats amont — autorisé.

### 17.2 Lots B-F (parallèles)

- **Lot B — Versioning (DEC-02)** : `foyer.FoyerMisAJour.v2` **rétrocompatible** (champ optionnel
  `anneeRevenus`) coexistant avec v1 dans `contracts-foyer` ; le consommateur `projection.service.ts`
  **dispatche par `version`** (décode v1 ET v2) ; tests de rétro-compatibilité (payload v1 toujours
  décodable). Pacts inchangés.
- **Lot C — Typage web↔gateway (DEC-03)** : `apps/web` dérive ses types HTTP de
  `gatewayOpenApiDocument` (`@creche-planner/contracts-kernel`) via un **interpréteur de JSON Schema
  au niveau type** (`apps/web/src/api/openapi-types.ts`, zéro codegen, zéro dépendance externe ;
  seul ajout : dépendance **interne** `workspace:*` au kernel, import `type-only`). Une divergence
  contrat↔front casse `web:typecheck` (prouvé par `@ts-expect-error`). A révélé que `ContratVue.mode`
  est une chaîne libre au contrat → garde `estMode()` ajouté (comportement inchangé).
- **Lot D — Livraison & registre (DEC-04, DEC-06)** : `nx release` **par projet** (`independent`,
  conventionalCommits, changelogs par projet — dry-run : 6 déployables versionnés séparément) ; CI
  **image-par-service** via `nx affected` (matrix `build-images`, un service non modifié n'est pas
  reconstruit) ; garde `.github/workflows/scripts/can-i-deploy.mjs` (vérifie la complétude des pacts
  api-gateway→4 providers) ; **[ADR-0005](adr/0005-registre-de-contrats.md)** (pas de Pact Broker
  offline → pacts fichiers + garde, limites assumées) ; runbook §8 « déploiement d'un service isolé ».
  Les **4 vérifs Pact provider** (Postgres) restent préservées en CI.
- **Lot E — Observabilité du repli (DEC-05)** : compteur OTel
  `tarification_repli_planification_total` (tag `simule`) incrémenté à chaque repli
  tarif→planif dans `fallback/planification.client.ts` (condition de déclenchement **inchangée**) ;
  dashboard Grafana `docker/grafana/dashboards/04-repli-synchrone.json` + alertes Prometheus
  (`docker/prometheus/alerts.yml`) ; doc `observabilite.md` à jour.
- **Lot F — Hygiène (DEC-07/08/09)** : nouvelle lib **`@creche-planner/resilience`**
  (`type:infrastructure`, `context:shared`, 100 % couverte) factorisant `CircuitBreaker`/retry/
  `fetchAvecTimeout` ; `resilience.ts` de la gateway et de tarification deviennent de **fines
  réexports** (les deux comportements `executerResilient`/`executerOuRepli` conservés) ; `Dockerfile`
  **multi-stage par service** (`nx prune $APP` → image minimale, plus de `COPY` du workspace entier) ;
  **garde-fou de pureté** du `shared-kernel` (`purete.guard.spec.ts` : échoue si un import framework
  ou un `fan-out > 0` est introduit).

### 17.3 Intégration & écarts

- **Bug corrigé à l'intégration** : le spec Lot E utilisait un `await import()` **top-level**
  (interdit en CJS → TS1309) ; remplacé par le pattern vitest `vi.hoisted` + import statique.
- **17 projets** au lieu de 16 (Lot A) : +`resilience`. `nx release version --dry-run` bumpe les
  6 déployables `0.0.1 → 0.1.0` indépendamment (rien écrit).
- **Méthode** : un agent (Lot D) a planté en cours (« API Overloaded ») en laissant des modifs
  partielles **valides** (nx.json + ci.yml + script) ; complété par un second agent plutôt que
  rejoué — illustre la robustesse de l'orchestration sur fichiers disjoints.

### 17.4 Suivi ouvert (non bloquant) — pipeline métriques

⚠️ **DEC-05 partiel** : la métrique de repli est **émise** (code) et les **tableaux/alertes
provisionnés**, mais le collecteur OTel n'a aujourd'hui qu'un pipeline **traces** → la métrique
**n'atteint pas encore Prometheus**. Pour la rendre exploitable de bout en bout (hors périmètre du
lot, à traiter séparément) : (1) MeterProvider + `PeriodicExportingMetricReader` + exporter OTLP
métriques au bootstrap (`libs/observability`) ; (2) pipeline `metrics` dans
`docker/otel-collector-config.yaml` (exporter `prometheus`, ex. port 8889) ; (3) scrape de
`otel-collector:8889` dans `docker/prometheus.yml` ; (4) exposition du port dans `docker-compose.yml`.
L'ajout de `@opentelemetry/sdk-metrics` (dépendance) serait à justifier. Tant que ce câblage n'est
pas fait, le dashboard #4 et les alertes restent inertes (aucune régression : l'instrumentation est
un no-op silencieux sans MeterProvider).

## 18. Phase 12 réalisée — Accessibilité AA & utilisabilité (CT-UT)

> ✅ **Réalisée le 2026-06-05** par **agents parallèles** (méthode §16.3), **front-only** sur
> `apps/web` : Lot 1 fondation a11y seul → Lots 2-6 en parallèle sur fichiers disjoints →
> intégration centralisée. **`nx run-many -t lint typecheck test build` vert sur `web` (206 tests,
> 27 fichiers)**. Services/domaines/contrats/pacts **inchangés** (périmètre front strict). Branche
> `feat/phase-12-accessibilite`. Met en œuvre la [spec 11](11-spec-accessibilite-ct-ut.md) selon le
> [plan 12](12-plan-implementation-accessibilite.md).

### 18.1 Lot 1 — Fondation a11y (primitives & hooks partagés)

Primitives **nouvelles** consommées par les lots 2-6 (interfaces stables) :

- `ui/Abbr.tsx` — `<abbr title>` focusable ; `title` résolu via le glossaire si absent.
- `utils/glossaire.ts` — **source de vérité unique** des sigles (`GLOSSAIRE`, `libelleSigle`,
  `estSigleConnu`) : RFR, PSU, ABCM, ALSH, PAI, PAJE.
- `ui/ModaleConfirmation.tsx` — wrapper de la `Modale` existante (Phase 10, **non dupliquée**) ;
  props `{ ouvert, titre, message, libelleConfirmer, onConfirmer, onAnnuler, destructif? }` ;
  **focus initial sur « Annuler »** ; Échap/overlay → `onAnnuler`.
- `hooks/useAnnonceRoute.ts` — `{ refCible, regionLiveProps }` : déplace le focus + annonce
  (`aria-live="polite"`) au changement de `pathname`.
- `hooks/usePersistanceAbsences.ts` — `{ lire, ecrire, effacer }` par (contrat, mois) en
  `sessionStorage`. **L'objet de retour est mémoïsé** (`useMemo`) : voir §18.3.

### 18.2 Lots 2-6 (parallèles, fichiers disjoints)

- **Lot 2 — UT-02 (`App.tsx`)** : `useAnnonceRoute` câblé ; focus programmatique vers
  `<main id="contenu" tabindex="-1">` + annonce du titre courant à chaque navigation ; lien
  d'évitement préservé. Coquille extraite **dans** `<BrowserRouter>` (le hook utilise `useLocation`).
- **Lot 3 — UT-01 (`PlanningPage.tsx`)** : motif **ARIA Tabs complet** — `id`/`aria-controls` sur
  chaque `tab`, contenu `role="tabpanel"` `aria-labelledby`, navigation flèches/Home/End,
  **roving tabindex**. Structure à deux niveaux (onglets enfant → onglets mode) ⇒ tabpanels imbriqués.
- **Lot 4 — UT-07 (`CalendrierCreche.tsx`)** : absences **persistées** par (contrat, mois) (plus de
  perte au changement de mois, pas de fuite entre mois) ; **saisie en lot** accessible au clavier
  (multi-sélection cochée + « appliquer à tous les jours gardés »).
- **Lot 5 — UT-03/04/05/06/08/10 (`foyer/*`, `utils/erreurs.ts`)** : `window.confirm` →
  `ModaleConfirmation` (parcours BFF inchangé) ; message générique **orientant** + focus porté sur
  la section ; `id` + `aria-describedby` sur l'erreur `nbEnfantsACharge` ; `aria-label` contextuel
  des boutons « Retirer » ; sigles via `Abbr` ; **bug ALSH corrigé** (§18.3).
- **Lot 6 — UT-08/09 (`couts/*`, `utils/money.ts`)** : sigles via `Abbr` ; **repère non coloré** du
  delta (▼ économie / ▲ dépassement / = identique) + libellé `sr-only`, y compris le cas d'égalité.
  `money.ts` reste **pur** (helpers `sensDelta`/`repereDelta`, calcul inchangé).

### 18.3 Intégration & écarts

- **Bug bloquant corrigé à l'intégration** : `usePersistanceAbsences` renvoyait un **nouvel objet**
  `{ lire, ecrire, effacer }` à chaque rendu. Le `useEffect` de `CalendrierCreche` dépendant de
  `persistance` entier rebouclait alors **indéfiniment** (boucle de rendu CPU → suite de tests
  bloquée). Corrigé en **mémoïsant l'objet de retour** (`useMemo`) dans le hook (primitive Lot 1).
  Les agents Lots 3/4 n'avaient pas confirmé leurs specs (blocage sur watcher) → l'orchestrateur a
  isolé le hang par fichier avec un **timeout OS dur** (un `testTimeout` n'interrompt pas une boucle
  synchrone).
- **Test Lot 3 ajusté** : `getByRole('tabpanel')` levait « multiple elements » (deux tabpanels
  imbriqués) → ciblage par nom accessible `getByRole('tabpanel', { name: 'Alice' })`.
- **UT-10 — écart amont assumé** : le champ « ALSH » **n'existe pas** dans le DTO `InscriptionsJour`
  (`{ cantine?, periMatin?, periSoir? }`) ; côté domaine l'ALSH se saisit par dates explicites
  (`JourAlsh[]`). La colonne « Inscrit ALSH » écrivait par erreur dans `cantine` : corrigé pour
  écrire dans une clé front dédiée `alsh` (tolérée par le passthrough gateway, ignorée par le
  service), **sans toucher le contrat d'API** ; écart documenté en commentaire dans `ContratForm.tsx`.

### 18.4 Lot 7 — Intégration & audit runtime (✅ exécuté le 2026-06-05)

Exécuté par agents parallèles (fichiers disjoints) + intégration centralisée, branche
`feat/phase-12-audit-runtime`.

- **Audit automatisé axe-core** : devDep de test `@axe-core/playwright@^4.11.3` ajoutée à `apps/web`
  (justifiée Lot 7 §3) ; nouveau spec `apps/web/e2e/a11y.e2e.spec.ts`. Il réutilise le `webServer`
  vite existant, amorce `localStorage`/`sessionStorage` + mocke `/api/v1/**` (comme `parcours.e2e`),
  puis lance `AxeBuilder().withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])` route par route.
  **Résultat : 0 violation AA** sur les 6 routes (accueil→planning, foyer, contrats, planning/onglets
  UT-01, coûts mensuels, coûts annuels) ; quelques `incomplete` (≤2) = contrôles de contraste qu'axe
  ne tranche pas seul → relèvent du test de contraste instrumenté manuel (doc 13 §7). UT-01 et UT-02
  ont en plus des assertions ARIA/comportementales dédiées (tabpanel relié, focus `main#contenu` +
  région live à la navigation, lien d'évitement préservé).
- **Non-régression** : `nx run-many -t lint typecheck test build` **vert sur les 17 projets** ;
  **E2E Playwright 8/8** (7 axe + parcours Phase 8). Services/pacts inchangés (front-only).
- **Revue clavier + lecteur d'écran (NVDA/VoiceOver)** : ne s'automatise pas → **runbook
  actionnable** livré dans [doc 13](13-validation-accessibilite-runtime.md) (parcours clavier seul,
  scripts NVDA/VoiceOver ciblant UT-01/UT-02, inspection multi-évaluateurs, test modéré 5-8
  participants, questionnaire SUS, contraste instrumenté, gabarit de consignation). À dérouler par
  un humain ; aucune dépendance bloquante côté code.
- **Campagne instrumentée du runbook (2026-06-05)** : passe assistée au navigateur (DOM/ARIA +
  événements clavier + calcul de contraste) consignée en [doc 13 §9](13-validation-accessibilite-runtime.md).
  Vérifiés au runtime : UT-01 (onglets 2 niveaux, flèche+Entrée, roving tabindex), UT-02 (focus
  `main#contenu` + annonce live), UT-03 (focus-trap, Échap, retour focus), UT-06/UT-08 ; contraste
  **4 combinaisons ≥ AA** (`--gris` 4,63 limite). Reste humain : écoute NVDA/VoiceOver, panel users, SUS.
- **EC-01 corrigé** (trouvé en campagne) : la modale focalisait le « × » au lieu de « Annuler »
  (course d'effets parent/enfant). `Modale` accepte désormais `refFocusInitial` (cible prioritaire) ;
  `ModaleConfirmation` lui passe `refAnnuler` (suppression de son `useEffect` de redirection).
  Vérifié au runtime + tests modales (15) + suite web (206) + E2E (8) verts. Conforme UT-03 CA2.

**Conclusion Phase 12** : objectif **WCAG 2.1 AA tenu et instrumenté** (audit automatisé en CI via
le spec e2e a11y + campagne runbook instrumentée). Reste purement humain et non bloquant : écoute
lecteur d'écran NVDA/VoiceOver, panel utilisateurs, SUS.

## 19. Phase 15 réalisée — Tests E2E sur stack réelle

> ✅ **Réalisée le 2026-06-06**, branche `feat/phase-15-e2e-stack-reelle`. Ajoute l'étage **E2E sur
> pile réelle** (seed → stack dockerisée → vraie UI, **sans aucun mock réseau**) et l'**intègre au CI
> et au flux de dev**. Met en œuvre la [spec 15](15-spec-tests-e2e-stack-reelle.md). Pré-requis :
> travaux doc 14 mergés (seed de référence, API contrats).

### 19.1 Objectif

Combler les deux angles morts révélés par des régressions vues en usage réel alors que la suite
(~206 unit/composant + pacts + E2E **mocké**) était verte : l'E2E front mockait le BFF (`page.route`)
donc ne validait aucune intégration réelle, et le CI **construisait** les images sans jamais les
**démarrer**. La phase **ajoute** un niveau intégration — elle ne remplace pas l'E2E mocké
(`parcours.e2e.spec.ts`), conservé pour le feedback rapide.

### 19.2 Ce qui est livré

- **Harnais Playwright dédié** : `apps/web/playwright.stack.config.ts` (`testMatch:
**/*.stack.e2e.spec.ts`, **pas de mock**, `baseURL = http://localhost:4200` servi par le conteneur
  web) + helper `apps/web/e2e/support/stack.ts`.
- **Script d'orchestration** `scripts/e2e-stack.mjs` : `docker compose up -d --build --wait` (attente
  des healthchecks) → `node scripts/seed-demo.mjs --verify` (état connu) → Playwright stack →
  `docker compose down -v` (teardown + purge volumes).
- **Parcours couverts** (`*.stack.e2e.spec.ts`) — rejouent les **vrais cas** (forme issue de l'API,
  projection NATS asynchrone) : foyer → **4 contrats listés** (régression doc 14) ; **planning crèche**
  (jours du contrat seulement, **week-end exclu**) ; **planning ABCM** (jours inscrits, garde de
  période) ; **coût consolidé** (`/couts` lu via `expect.poll`, projection asynchrone).
- **CI** (`.github/workflows/ci.yml`) — deux jobs **bloquants** ajoutés, `e2e-web` (mocké) **conservé** :
  - **`smoke-stack`** : démarre la pile, vérifie la santé des services + `GET /api/v1/couts`, `down -v`.
  - **`e2e-stack`** : monte la pile, seed, lance la suite Playwright stack.
- **Durcissement du seed** : `scripts/seed-demo.mjs --verify` est un **garde bloquant** (`exit 1` si
  les coûts attendus ne sont pas atteints) → l'E2E démarre sur un état vérifié.
- **Processus** : règle d'équipe en [doc 03 §6](03-standards-developpement.md), case dans
  `.github/pull_request_template.md`, sous-section README « Tests E2E sur stack réelle ».

### 19.3 DoD Phase 15 (✅ atteinte)

- [x] **DoD-1** — Suite E2E « stack réelle » sur la pile complète (`docker compose up`), **sans mock
      réseau**, amorcée par le seed de référence.
- [x] **DoD-2** — **`smoke-stack`** démarre la stack en CI et vérifie santé + `GET /api/v1/couts`,
      bloquant.
- [x] **DoD-3** — **`e2e-stack`** tourne en CI (job dédié), **bloquant avant merge**.
- [x] **DoD-4** — Processus documenté : règle d'équipe (doc 03), checklist PR, README.
- [x] **DoD-5** — Les parcours rejouent les **vrais cas** (données API, projection NATS via
      `expect.poll`) ; le seed `--verify` interdit de partir d'un état faux.

### 19.4 Commandes de lancement

```bash
pnpm e2e:stack            # script racine : up --wait → seed --verify → Playwright stack → down -v
pnpm nx e2e-stack web     # même chose via la cible Nx du projet web
```

Prérequis : **Docker Desktop** démarré (la pile complète est montée et purgée par le script).

### 19.5 Pièges

- **`e2e/` hors `tsconfig`** : le dossier `e2e/` n'est dans aucun `tsconfig` (Playwright compile via
  esbuild) — ne pas s'attendre à un type-check des specs par `tsc`.
- **Ports à libérer** : **3000** (gateway), **4200** (web), **5433-5436** (4 Postgres), **4222** (NATS).
- **Conflit sur 4200** : le **web docker** et `pnpm nx serve web` se disputent le port 4200 — **ne pas
  lancer les deux en même temps** que la stack (la suite cible le conteneur, pas le serveur Vite de dev).
- **Projection NATS asynchrone** : les coûts arrivent par eventual consistency → **`expect.poll`** (≈15 s),
  **jamais** d'attente fixe.
- **Seed `--verify` = garde bloquant** : un échec de vérification des coûts **arrête** le run (`exit 1`)
  avant Playwright — c'est volontaire (ne pas tester un état faux).
- **Sérialisation (`workers: 1`)** : la stack est un **état partagé unique** ; la config stack force un
  seul worker (en plus de `fullyParallel: false`). Indispensable : en parallèle, des specs concurrentes
  saturent la gateway et l'endpoint lent `/couts/annuel` bascule en repli **502** (cf. §19.7).
- **Lecture des coûts annuels** : NE PAS `page.reload()` à chaque essai de poll — un reload **avorte** la
  requête `/couts/annuel` (lente) en vol → échec en boucle. Le helper relance via le bouton
  « Réessayer » de la page et laisse la requête aboutir.

### 19.6 Découverte : garde de période absente des calendriers (corrigée)

La toute première exécution de la suite stack a **immédiatement révélé un vrai bug produit** (raison
d'être de la phase) : `CalendrierAbcm` **et** `CalendrierCreche` dérivaient les jours réservés/gardés de
la **seule semaine-type**, sans borner par la **période de validité** du contrat (`valideDu`/`valideAu`).
Conséquence : en forçant l'onglet « Cantine » sur **juin 2026** (contrat ABCM démarrant le 2026-09-01),
le calendrier affichait **14 jours « Cantine » fantômes** alors que le coût restait nul (la garde de
période est correcte côté `svc-tarification`). État atteignable par simple clic d'onglet.

**Correctif** (front, minimal) : les deux calendriers filtrent désormais chaque jour par
`jour ≥ valideDu && (valideAu === null || jour ≤ valideAu)`. Les 206 tests unitaires/composant restent
verts (leurs contrats portent `valideAu: null` sur les mois testés). Calendriers désormais cohérents.

### 19.7 Latence de `/couts/annuel` (✅ résolu)

**Symptôme initial** : `GET /api/v1/couts/annuel` agrégeait 12 mois en **~1–4 s à froid** ; sous contention
il **frôlait/dépassait le délai de repli 502** de la gateway (observé en navigateur pendant la validation).
Mitigé côté test (sérialisation + relance sans reload), mais la performance/robustesse de l'agrégation
restait à traiter.

**Cause racine** : `CoutService.coutAnnuel` bouclait sur les 12 mois **en série**, chaque mois rechargeant
le **foyer** et la **liste des contrats** (identiques pour les 12 mois) + sa propre requête `prestation_mois`
→ ~36 requêtes SQL séquentielles. Sous charge concurrente, le coût **CPU** des 12 valorisations mensuelles
se sérialisait sur l'unique event loop de `svc-tarification` (calculs identiques recalculés par requête).

**Correctif** (`apps/svc-tarification` + `apps/api-gateway`, lecture seule, sortie inchangée — pacts intacts) :

1. **Foyer + contrats chargés une seule fois** puis 12 mois calculés **en parallèle** (`Promise.all`) —
   la latence devient celle du mois le plus lent, pas la somme.
2. **Une seule requête `prestation_mois`** pour les 12 mois (`like '<annee>-%'`), groupée en mémoire
   (`chargerProjeteesAnnee`) — ~3 requêtes/appel au lieu de ~14 (« lire, pas ré-interroger »).
3. **Single-flight** (`annuelEnVol`) : les requêtes annuelles **identiques** concurrentes (cas des polls
   navigateur / specs E2E) partagent un seul calcul en vol — pas de cache TTL, donc aucune péremption.
4. **Gateway** : budget de timeout dédié à la route annuelle (`OPTIONS_ANNUEL` = 8 s, **sans retry** — un
   GET coûteux ré-essayé aggraverait la contention).

**Mesures** (stack `docker compose`, foyer de référence, après `seed --verify`) : à froid **~0,6–0,8 s** (< 1 s) ;
**12 requêtes annuelles concurrentes identiques → toutes 200 en ≤ 0,93 s** (avant : ~7 s / 502). Run-many
17 projets vert, E2E stack (`pnpm e2e:stack`) vert, pacts inchangés.

## 20. Phase MBT — Tests model-based (ISTQB CT-MBT) (✅ réalisée le 2026-06-07)

> ✅ **Réalisée le 2026-06-07**. Ajoute une couche de tests **model-based** explicite au prisme
> **ISTQB® CT-MBT**, par-dessus une couverture domaine déjà à 100 %. Détail et matrice de
> traçabilité en **[doc 17](17-tests-model-based-ct-mbt.md)**.

- **Périmètre** : **4 libs domaine** (`shared-kernel`, `foyer/domain`, `planification/domain`,
  `tarification/domain`) + **1 modèle d'état système** (E2E saisie de planning, S0..S4).
- **Démarche** : pour chaque SUT, un **modèle** (machine à états / table de décision / BVA /
  invariant) et un **critère de couverture déclaré** (0-switch + 1-switch ; combinatoire
  complète ; 3 points par borne ; génération bornée), d'où l'on **dérive** les cas.
- **Outils** : **`it.each`** (tabulaire data-driven pour tables de décision et BVA) et
  **`fast-check` 4.8** (property-based + machines à états via `fc.commands` / `fc.modelRun`).
- **Volume** : **~260 cas / propriétés MBT** ajoutés (shared-kernel 70, foyer 52,
  planification 97, tarification 102, + modèle système) dans des fichiers `*.mbt.spec.ts`.
- **Résultat** : **couverture 100 % maintenue** sur les 4 libs domaine ; **0 bug de
  production** (les modèles confirment la conformité au [doc 02](02-modele-de-cout.md)).
- **Piège** : `nx test` exécute mais ne **type-check** pas comme `nx typecheck` — les specs MBT
  doivent passer **les deux** cibles.

## 21. Audit gestion des tests — CTAL-TM v3.0 & TMMi (✅ réalisé le 2026-06-07)

> ✅ **Réalisé le 2026-06-07** (audit lecture seule, multi-agent). Évalue le projet sous le
> prisme **ISTQB CTAL-TM v3.0** (gestion des tests) et **TMMi** (maturité d’industrialisation).
> Rapport complet : **[doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md)**.

- **Verdict TMMi** : **niveau 1 formel** — le niveau 2 est bloqué par les PA _Test Policy &
  Strategy_ (2.1) et _Test Planning_ (2.2) en _Partially_, alors que _Test Design & Execution_ (2.4)
  et _Test Environment_ (2.5) sont _Fully_. Profil hétérogène : **exécution mûre, gouvernance
  émergente**.
- **CTAL-TM** : Ch.1 Établi (lacunes : plan/estimation), Ch.2 Risque produit Émergent, Ch.3
  Anomalies Émergent, Ch.4 Amélioration Établi, Ch.5 Outils Établi→Optimisé.
- **Leviers P1** (faible coût, forte valeur) : plan de test par phase ; publier les métriques en
  artefacts CI ; registre de risque produit coté ; chaîne sécurité (Dependabot/`pnpm audit`) ;
  ligne « cause racine + action » sur chaque `fix:`.
- **Plafond structurel** : tout le **niveau 4 (mesure)** manque — pipeline OTel→Prometheus non câblé.
- **Portée** : rapport seul, **aucune remédiation appliquée** (feuille de route en doc 18 §8).

## 22. Remédiation de l'audit de gestion des tests — P1 + P2 (✅ réalisée le 2026-06-07)

> ✅ **Réalisée le 2026-06-07**. Implémente les **16 actions P1 + P2** de la feuille de route
> [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 (la P3 reste hors périmètre). Livrée en
> **4 branches thématiques** mergées dans `main` en `--no-ff` (non poussé). Objectif : faire passer
> la gouvernance de test d'**implicite** à **nommée, mesurée et auditable** → consolider un
> **Niveau 2 TMMi complet** et débloquer la mesure (niveau 4).

**Branche `docs/gouvernance-tests`** (artefacts de gouvernance) :

- **P2-1 / P2-2** — [doc 21](21-politique-strategie-test.md) : politique de test (objectifs + 3 KPI :
  couverture domaine, défauts en usage réel, flakiness) et stratégie nommée par niveau.
- **P1-1** — [doc 20](20-plan-de-test.md) : plan de test par phase, **critères d'entrée** explicites +
  sortie reliés aux KPI, gabarit réutilisable.
- **P1-4** — [doc 19](19-registre-risque-produit.md) : registre de risque produit coté (P×I → niveau →
  tests d'atténuation), 7 risques 🟥 tous gardés en CI.
- **P2-5** — [doc 22](22-registre-anomalies.md) : registre d'anomalies structuré (13 entrées) + **DDP
  par niveau** (E2E stack réelle = 55 % des défauts, unitaire domaine = 0 %).
- **P1-5** — [doc 17](17-tests-model-based-ct-mbt.md) §2.5 : traçabilité explicite des 8 invariants
  (INV-02/03/07/08 ajoutés, **déjà couverts** — aucun test ajouté).
- **P1-7** — convention « cause racine + prévention » sur les `fix:` ([doc 03](03-standards-developpement.md)
  §8 + PR template).

**Branche `ci/securite-mesure`** (CI / sécurité / mesure) :

- **P1-2** — reporters **JUnit + couverture lcov/json-summary** en CI (vitest, gardés par `CI`) ;
  résumé `GITHUB_STEP_SUMMARY` (`scripts/test-summary.mjs`) + artefacts.
- **P1-3** — discours couverture aligné (doc 03 §6) : 100 % domaine enforced, **pas** de seuil global
  chiffré non appliqué (mesuré et publié sans porte).
- **P1-6** — chaîne sécurité : **Dependabot** + job CI `security` bloquant (`pnpm audit --prod`
  high/critical) + audit complet informatif + **CodeQL** (SAST). Les advisories actuelles sont des
  outils de test (underscore via Pact), hors runtime de production.
- **P2-4** — `.github/ISSUE_TEMPLATE/bug.yml` (gravité/priorité/niveau de détection/repro/statut).
- **P2-7** — `smoke-stack` / `e2e-stack` restreints aux **déployables affectés** (temps CI).
- **P2-9** — section « Revue assistée par IA » dans le PR template.

**Branche `perf/infra`** :

- **P2-6** — smoke perf `/api/v1/couts/annuel` (`scripts/perf-smoke.mjs`, zéro dépendance) branché dans
  `smoke-stack`, SLO p95 documenté ([doc 23](23-smoke-performance.md)) + plafond CI anti-régression.
- **P2-8** — images d'observabilité **épinglées par digest** (otel-collector / tempo / prometheus /
  grafana / nats-exporter) au lieu de `:latest`.

**Branche `feat/metriques-otel-prometheus`** :

- **P2-3** (la plus lourde, **traitée intégralement + Alertmanager**) — pipeline métriques
  OTel→Prometheus **câblé et opérant** : `MeterProvider` (libs/observability), pipeline `metrics` du
  collecteur (exporter prometheus :8889), scrape + section `alerting` Prometheus, service **Alertmanager**
  (`docker/alertmanager.yml`). **Vérifié en local** : `up{job="otel-metrics"}=1`, Alertmanager découvert
  et sain. Détail : [observabilité](exploitation/observabilite.md). Les alertes du groupe
  `repli-synchrone` sont désormais armées.

**Validation** : `nx affected -t lint typecheck test build` vert sur les projets sans DB + typecheck/build
des `svc-*` ; configs CI/observabilité validées par leurs binaires (`otelcol`/`promtool`/`amtool`,
`docker compose config`) ; hooks husky (commitlint + lint-staged) passés à chaque commit.

**Restes / suivi** :

- **P3** non traitée (hors périmètre) : registre d'amélioration centralisé, DRE/échappées, mutation
  testing, diversification des jeux de données, BVA sur DTO gateway, chaos automatisé, `CHANGELOG.md`
  via `nx release` (cf. doc 18 §8 P3-1..8).
- **Notification Alertmanager** : aucun canal externe (Slack/e-mail) configuré en contexte solo —
  alertes visibles dans l'UI `:9093` ; brancher un receiver dans `docker/alertmanager.yml` si besoin.
- **Non poussé** : branches mergées dans `main` local, **push à la main** par l'auteur.

## 23. Feature Notifications & validation hebdomadaire (🚧 en cours — Lots 0→4 livrés)

> Première **action sortante vers un tiers réel** (e-mail crèche / école). Objectif : chaque **mardi**,
> notifier le parent pour **valider le planning de la semaine N+1** (e-mail + indicateur in-app) ; en cas
> de modification, relire un **brouillon récapitulatif** puis **envoyer un mail au service** concerné.
> Plan détaillé approuvé hors dépôt ; découpage en **7 lots mergeables** (chacun PR + CI verte).

**Architecture** — nouveau microservice `apps/svc-notifications` (6e service, **base dédiée**, cloné de
`svc-tarification`). Il consomme le stream NATS `PLANIFICATION` pour projeter un read-model des contrats,
héberge l'état de validation hebdo, la **config des établissements** et le journal d'envois, ainsi que le
scheduler du mardi et l'**unique** dépendance e-mail. Justification : l'effet de bord « e-mail vers un
tiers » doit être **isolé, tracé et coupable** (dry-run par défaut + allowlist). La lib e-mail vit dans
`libs/nest-commons/src/lib/mailer/` (`EmailModule.forRoot`), importée **seulement** par notifications.

**Divergences produit gardées en tête** : (1) il n'existe **pas de mode « ABCM »** —
`MODES_CONTRAT = ['CRECHE_PSU','PERISCOLAIRE','CANTINE','ALSH']` ; ABCM est l'**établissement** regroupant
les 3 derniers → mapping codé `mode → clé` (`CRECHE_PSU → CRECHE_HIRONDELLES` ; sinon `ABCM`). (2) Le
**préavis** diverge par établissement (2 j ouvrés crèche RM-03 ; jeudi 12h ABCM RM-07) → modélisé en
**paramètre `preavisRegle`** par établissement, pas en constante.

**Lots livrés** :

- **Lot 0 — Scaffold** (PR #57, `33b57a6`) : service `svc-notifications`, tables d'infra latentes
  (`processed_event` + `outbox`), entrées `docker-compose`.
- **Lot 1 — Read-model contrats** (PR #58, `de3c5a0`) : consumer JetStream idempotent abonné au seul
  stream `PLANIFICATION` (`ContratCree/Modifie/Supprime` → table `contrat`), migration 0001.
- **Lot 2 — Lib mailer dry-run** (PR #59, `056f0f3`) : `EmailModule.forRoot` + `MailerService.envoyer`
  (nodemailer), **garde-fous dry-run + allowlist** court-circuitant le transport (retour
  `{messageId:null,dryRun:true}`).
- **Lot 3 — Config établissements** (PR #60) : table `etablissement_destinataire` (migration **générée**
  0002), module `etablissement` (lister + upsert par clé, **seed idempotent** des 2 établissements au
  démarrage), client résilient `NotificationsClient` + BFF `GET/PUT /api/v1/etablissements/{cle}`, écran
  web `etablissements/` (formulaire e-mail + règle de préavis, `useActionState`, a11y), OpenAPI +
  `EtablissementVue`/`PreavisRegle` (types web dérivés régénérés). Tests : DTO Zod + mapping, contrôleur,
  **Pact** consumer (gateway) + provider (notifications), web.
- **Lot 4 — Validation hebdo + indicateur in-app** (PR #61) : table `notification_hebdo` (snapshot des jours
  de la semaine N+1 + `delta_modifs`, `UNIQUE(contrat_id, semaine_iso, type)`, migration **générée** 0003).
  Le planning amont est **mensuel et sans notion de semaine ni de validation** : ce lot l'ajoute via deux
  **modules purs** — mapping semaine ISO `YYYY-Www` ↔ mois/jours (arithmétique UTC, **chevauchement de 2
  mois** géré) et **diff jour-par-jour** snapshot↔relecture. Client interne de **relecture du planning**
  (cloné du repli `svc-tarification`, `PLANIFICATION_URL`) avec **dégradation propre** : une relecture
  indisponible conserve le snapshot (statut `VALIDEE` sans faux positif) plutôt que de planter. Endpoints
  `GET /api/validations/a-valider?foyer=` et `POST /api/validations/:contratId/:semaineIso` (**idempotent** :
  revalider renvoie l'état figé ; `VALIDEE` / `VALIDEE_AVEC_MODIFS` selon le diff). La méthode `notifier()`
  (snapshot + insert idempotent) est **exposée pour le scheduler du Lot 5**. BFF `GET /api/v1/notifications/a-valider`
  - `POST /api/v1/notifications/validations/...`. Web : hook `useNotifications`, **encart « Valider la semaine
    suivante »** en tête du planning (masqué s'il n'y a rien) et **pastille** de compteur dans la navigation.
    Tests : **property test** du mapping (`semaine.mbt.spec.ts`), diff, idempotence, relecture dégradée, web
    (encart + pastille), **Pact** consumer + provider. Les types web des routes notifications sont **saisis à
    la main** (comme la saisie de planning) : ces routes ne sont pas décrites dans l'OpenAPI de la gateway, il
    n'y a donc rien à dériver — `openapi-types-drift` reste vert.

**Lots restants** : Lot 5 (scheduler du mardi + mail récap parent — appellera `ValidationService.notifier()`),
Lot 6 (mail au service : relecture + envoi réel + journal).

**Pièges d'infra CI rencontrés au Lot 3** (à reproduire pour tout nouveau `svc-*`/contrat) : (a) la
**vérification Pact provider** exige un Postgres `services:` dédié dans `.github/workflows/ci.yml` + un
`<SVC>_DATABASE_URL` (notifications → 5437) ; (b) le job `openapi-types-drift` impose d'**ignorer
`**/\*.gen.ts`dans la config ESLint racine** (utilisée par lint-staged), sinon`eslint --fix`réécrit le
fichier généré au commit ; (c) le surrogate`can-i-deploy.mjs`(ADR-0005) tient une liste codée`PROVIDERS_ATTENDUS` à laquelle **ajouter chaque nouveau provider**.
