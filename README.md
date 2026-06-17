# Crèche Planner — _(futur « Budget du foyer »)_

Application web personnelle pour **planifier les frais de garde** de deux enfants
et **calculer le coût mensuel consolidé**. Premier lot d'une future
**plateforme de budget familial**. Le dépôt embarque un **jeu de données de
référence fictif** (foyer type à deux enfants, Mia et Zoé).

Deux modes de garde couverts :

- **Crèche Les Hirondelles** (barème **PSU/CNAF**) — les deux enfants jusqu'à l'été 2026.
- **École ABCM** — l'aînée en maternelle : périscolaire, cantine,
  ALSH + frais annuels (tarifs par tranche de revenu fiscal de référence).

## Objectif

- Saisir / visualiser le planning par enfant et par mode (crèche, péri, cantine, ALSH).
- Calculer le coût mensuel : mensualité crèche lissée + compléments/déductions, et
  prestations ABCM à la séance/au repas + frais fixes.
- Projeter sur l'année, y compris la **transition** crèche → école de Zoé.

## Documentation de pilotage

Toute la conception vit dans [`docs/`](docs/) et **précède** le code :

| Doc                                                                    | Contenu                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — Spécification fonctionnelle](docs/01-spec-fonctionnelle.md)      | Périmètre, acteurs, user stories, règles métier, critères d'acceptation                                                                                                                                                                                    |
| [02 — Modèle de coût (PSU/CNAF)](docs/02-modele-de-cout.md)            | Formules, glossaire, invariants, jeu de cas de test chiffrés                                                                                                                                                                                               |
| [03 — Standards de développement](docs/03-standards-developpement.md)  | Clean code, SOLID, hexagonal, conventions, tests, Git, CI                                                                                                                                                                                                  |
| [04 — Architecture & technologies](docs/04-architecture-et-technos.md) | Comparatif techno, choix justifiés, découpage en **microservices**                                                                                                                                                                                         |
| [05 — Plan de développement](docs/05-plan-de-developpement.md)         | Phases, jalons, lotissement, definition of done                                                                                                                                                                                                            |
| [06 — État d'avancement & reprise](docs/06-etat-davancement.md)        | État post-Phase 7, arborescence, commandes, conventions, **interface web livrée (Phase 8)** + guide de reprise Phase 9                                                                                                                                     |
| [ADR](docs/adr/)                                                       | [0001 : microservices](docs/adr/0001-architecture-microservices.md) · [0002 : grain services & politiques tarifaires](docs/adr/0002-grain-services-et-politiques-tarifaires.md) · [0003 : décisions de toolchain](docs/adr/0003-decisions-de-toolchain.md) |

## Architecture (résumé)

**Microservices** (TypeScript de bout en bout) — 4 services + gateway + web :
`svc-foyer`, `svc-referentiel` (catalogue tarifaire), `svc-planification`,
`svc-tarification`. Base par service, communication REST + événements (NATS),
API Gateway/BFF, **front React PWA (`apps/web`) qui ne parle qu'au BFF**. Hexagonal + SOLID à l'intérieur de chaque service.
Calcul multi-modes via stratégies `PolitiqueTarifaire`. Détails en docs 04 + ADR.

## État du projet

🟢 **Phase 1 — Socle technique distribué** : _walking skeleton_ microservices qui compile,
teste et tourne en local.
🟢 **Phase 2 — Cœur métier tarifaire** : domaine de calcul pur (`tarification/domain`),
stratégies PSU/ABCM + consolidation foyer, **100 % couvert** (cas réels CT-01..20).
🟢 **Phase 3 — Service Foyer** : `svc-foyer` (domaine 100 %, outbox transactionnelle, contrat Pact).
🟢 **Phase 4 — Service Référentiel** : `svc-referentiel`, catalogue tarifaire **versionné**
(grilles ABCM/PSU, frais fixes, calendrier), événement `GrillePubliee`, API « grille applicable »,
contrat Pact. Domaine `referentiel/domain` **100 % couvert**.
🟢 **Phase 5 — Service Planification** : `svc-planification` (port 3004), planning multi-modes **réel
et simulé**, génération des **prestations du mois** (jours non facturables du Référentiel exclus),
outbox + événements `ContratCree`/`PlanningModifie`, API `/api/contrats` & `/api/prestations`,
contrat Pact. Domaine `planification/domain` **100 % couvert (65 tests)**.
🟢 **Phase 6 — Intégration Tarification** : `svc-tarification` (port 3005), **read model**
alimenté par les événements des streams `FOYER`/`REFERENTIEL`/`PLANIFICATION`, **consommateurs
idempotents** (durables `processed_event`, `max_deliver` + backoff), **fallback synchrone**
(timeout/retry/circuit-breaker) si une projection est froide, calcul via `tarification/domain`,
API `/api/couts` & `/api/couts/annuel`, contrat Pact.
🟢 **Phase 7 — API Gateway / BFF** : `api-gateway` enrichi (port 3000), API **orientée écran**
sous **`/api/v1`** agrégeant Foyer/Planification/Tarification via des **clients REST résilients**
(timeout/retry/circuit-breaker), transverses **auth par token / CORS / rate-limit** (faits main, sans
dépendance), **OpenAPI** publié (`GET /api/openapi.json`), pacts consumer étendus aux écritures, et
**test E2E API** « créer foyer + contrats → lire le coût du mois » (bundle réel + services aval simulés).
🟢 **Phase 8 — Interface web** : `apps/web` (React 18 + Vite **PWA**, port **4200**), front qui ne
parle **qu'au BFF** (`/api/v1`). Saisie foyer/contrats, **calendrier mensuel** par enfant/mode
(FullCalendar), panneau **coût du mois** + **vue annuelle** + **mode simulation** (delta €). Types BFF
écrits à la main, état via hooks + `fetch` (zéro lib de state), auth Bearer optionnelle
(`VITE_GATEWAY_TOKEN`). **E2E Playwright** « créer foyer + contrat → planifier → lire le coût » (BFF mocké).
⏭️ **Phase 9 — Durcissement & exploitation** (prochaine étape). Voir [doc 05](docs/05-plan-de-developpement.md)
et le guide de reprise [doc 06](docs/06-etat-davancement.md).

## Monorepo (Nx + pnpm)

```
apps/
  web/                # [Phase 8] front React PWA (Vite, port 4200) — calendrier FullCalendar, panneau coût, vue annuelle, simulation ; ne parle qu'au BFF ; E2E Playwright
  api-gateway/        # BFF NestJS (port 3000) — agrégation /api/v1 (foyer+planif+tarif) via clients REST résilients, auth/CORS/rate-limit, OpenAPI ; pacts consumer + E2E API
  svc-foyer/          # service Foyer — Postgres (Drizzle), outbox + NATS, API /api/foyers
  svc-referentiel/    # catalogue tarifaire versionné — grilles/barèmes, outbox, API /api/grilles
  svc-planification/  # planning multi-modes réel/simulé — outbox + NATS, API /api/contrats & /api/prestations, port 3004, base 5435
  svc-tarification/   # read model + calcul du coût — consommateurs idempotents FOYER/REFERENTIEL/PLANIFICATION, fallback REST résilient, API /api/couts & /api/couts/annuel, port 3005, base 5436
libs/
  shared-kernel/      # value objects purs : Money, Duree, Tranche, DomainError (100% testés)
  contracts/          # OpenAPI/AsyncAPI + DTO Zod + événements (Foyer, Référentiel, Planification)
  observability/      # bootstrap OpenTelemetry + options pino corrélées
  tarification/
    domain/           # politiques tarifaires PSU/ABCM + consolidation foyer (TS pur, 100% testé)
  foyer/
    domain/           # value objects Foyer/Enfant + tranche dérivée (TS pur, 100% testé)
  referentiel/
    domain/           # versionnement catalogue : PeriodeValidite, sélection applicable (TS pur, 100% testé)
  planification/
    domain/           # génération prestations du mois, planning réel/simulé (TS pur, 100% testé)
pacts/                # contrats Pact versionnés (api-gateway → svc-foyer, → svc-referentiel, → svc-planification ; api-gateway → svc-tarification)
docker/               # configs otel-collector, tempo, prometheus, grafana
docker-compose.yml    # web + services + Postgres (×4) + NATS + OTel/Tempo/Prometheus/Grafana
```

**Frontières de modules** vérifiées au lint (`@nx/enforce-module-boundaries`) sur deux
axes : `type:*` (hexagonal : domain → application → infrastructure) et `context:*`
(isolation des bounded contexts ; seule passerelle inter-contextes : `libs/contracts`).

## Démarrer

Prérequis : **Node 24 (LTS)**, **pnpm** (via corepack), **Docker Desktop**.

```bash
pnpm install

# Qualité : lint + type-check + tests + build (shared-kernel à 100% de couverture)
pnpm nx run-many -t lint typecheck test build

# Front web en dev (Vite, HMR) — proxifie /api vers la gateway :3000
pnpm nx serve web        # http://localhost:4200

# Toute la pile locale (web + services + Postgres + NATS + observabilité)
docker compose up --build
```

### Tests E2E sur stack réelle

En plus de l'E2E **mocké** rapide (`apps/web/e2e/parcours.e2e.spec.ts`), un étage **E2E sur la pile
réelle** rejoue les parcours critiques (foyer → contrats, planning crèche, planning ABCM, coût
consolidé) contre la stack dockerisée, **sans aucun mock réseau**.

Prérequis : **Docker Desktop** démarré.

```bash
pnpm e2e:stack            # ou : pnpm nx e2e-stack web
```

La commande **monte la pile** (`docker compose up -d --build --wait`), **amorce un état connu**
(`node scripts/seed-demo.mjs --verify`, garde bloquant sur les coûts attendus), lance **Playwright
sans mock** (`baseURL` = http://localhost:4200 servi par le conteneur web), puis **purge tout**
(`docker compose down -v`).

> ⚠️ **Piège du port 4200** : le conteneur `web` et `pnpm nx serve web` se disputent le port 4200.
> Ne lance **pas** `nx serve web` en même temps que la stack — la suite cible le conteneur, pas le
> serveur Vite de dev. Ports utilisés par la pile : 3000, 4200, 5433-5436, 4222.

Une fois la pile levée :

| URL                                                                                 | Rôle                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| http://localhost:4200                                                               | **Front web (React PWA)** — saisie, planning, coût |
| http://localhost:3000/api/health                                                    | Gateway (readiness : dépend de svc-referentiel)    |
| http://localhost:3000/api/openapi.json                                              | Spécification OpenAPI du BFF (route publique)      |
| http://localhost:3000/api/referentiel/health                                        | Parcours distribué gateway → svc-referentiel → DB  |
| http://localhost:3000/api/v1/foyers (POST)                                          | BFF : créer un foyer + ses enfants (agrégation)    |
| http://localhost:3000/api/v1/contrats (POST)                                        | BFF : créer un contrat de garde                    |
| http://localhost:3000/api/v1/couts?foyer=&lt;uuid&gt;&mois=2026-10                  | BFF : coût consolidé du mois (lecture agrégée)     |
| http://localhost:3001/api/health                                                    | svc-referentiel (readiness : Postgres + NATS)      |
| http://localhost:3001/api/grilles/applicable?date=2026-09-15&tranche=3&mode=CANTINE | Grille ABCM applicable (catalogue versionné)       |
| http://localhost:3002/api/health                                                    | svc-foyer (readiness : Postgres + NATS)            |
| http://localhost:3004/api/health                                                    | svc-planification (readiness : Postgres + NATS)    |
| http://localhost:3004/api/prestations?contrat=<uuid>&mois=2026-03                   | Prestations du mois (quantités, jours exclus)      |
| http://localhost:3005/api/health                                                    | svc-tarification (readiness : Postgres + NATS)     |
| http://localhost:3005/api/couts?foyer=<uuid>&mois=2026-10                           | Coût du mois (read model + calcul `tarification`)  |
| http://localhost:3005/api/couts/annuel?foyer=<uuid>&annee=2026                      | Coût annuel consolidé (transition crèche → école)  |
| http://localhost:3003                                                               | Grafana (trace distribuée via Tempo)               |

Le `traceparent` W3C est propagé de la gateway vers le service ; les logs JSON pino des
deux services portent le même `trace_id` (corrélation), et la trace est visible dans Grafana/Tempo.
