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

Toute la conception vit dans [`docs/`](docs/) et **précède** le code.
**→ [Index complet de la documentation](docs/README.md)** (par thème et par
besoin) ; pour contribuer : [CONTRIBUTING.md](CONTRIBUTING.md) +
[CONVENTIONS.md](CONVENTIONS.md). Les incontournables :

| Doc                                                                                        | Contenu                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — Spécification fonctionnelle](docs/01-spec-fonctionnelle.md)                          | Périmètre, acteurs, user stories, règles métier, critères d'acceptation                                                                                                   |
| [02 — Modèle de coût (PSU/CNAF)](docs/02-modele-de-cout.md)                                | Formules, glossaire, invariants, jeu de cas de test chiffrés                                                                                                              |
| [03 — Standards de développement](docs/03-standards-developpement.md)                      | Clean code, SOLID, hexagonal, conventions, tests, Git, CI                                                                                                                 |
| [04 — Architecture & technologies](docs/04-architecture-et-technos.md)                     | Comparatif techno, choix justifiés, découpage en **microservices**                                                                                                        |
| [05 — Plan de développement](docs/05-plan-de-developpement.md)                             | Phases, jalons, lotissement, definition of done                                                                                                                           |
| [06 — État d'avancement & reprise](docs/06-etat-davancement.md)                            | **Source de vérité de l'avancement** : phases livrées, features, arborescence, commandes, conventions, guide de reprise                                                   |
| [24 — Déploiement & exploitation](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md) | Production : portes de déploiement, topologie pull-based, runbooks (dossier [`docs/exploitation/`](docs/exploitation/))                                                   |
| [ADR](docs/adr/)                                                                           | 0001 → 0006 : microservices · grain des services & politiques tarifaires · toolchain · décentralisation des contrats · registre de contrats · préférences de notification |

## Architecture (résumé)

**Microservices** (TypeScript de bout en bout) — 5 services + gateway + web :
`svc-foyer`, `svc-referentiel` (catalogue tarifaire), `svc-planification`,
`svc-tarification`, `svc-notifications` (email + in-app). Base par service,
communication REST + événements (NATS), API Gateway/BFF, **front React PWA
(`apps/web`) qui ne parle qu'au BFF**. Hexagonal + SOLID à l'intérieur de chaque
service ; contrats **décentralisés par contexte** (`libs/contracts/*`, ADR-0004/0005).
Calcul multi-modes via stratégies `PolitiqueTarifaire`. Détails en docs 04 + ADR.

## État du projet

🚀 **En production** (version `0.8.0`, 2026-07) — déployée par **trains de release**
successifs (8 à ce jour) sur un serveur auto-hébergé, derrière Cloudflare Access
(voir [doc 24](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)).

Les **phases 1 → 12** du plan initial sont **réalisées** : socle distribué, cœur
métier tarifaire pur (100 % couvert, CT-01..20), les 5 services, API Gateway/BFF
(`/api/v1`), interface web React PWA, durcissement & exploitation, navigation/UX,
découplage micro-services, accessibilité **WCAG AA**. S'y ajoutent les features
livrées en continu : **notifications & validation hebdomadaire**, **parents du
foyer** (identité Cloudflare Access + isolation par foyer), **établissements en
entité libre**, **cycle de vie du foyer**, **tableau de bord « ma journée »**,
**profil parent & préférences de notification** (+ désabonnement RGPD).

L'état d'avancement détaillé (**source de vérité**) vit en
[doc 06](docs/06-etat-davancement.md) ; le plan initial en
[doc 05](docs/05-plan-de-developpement.md) (document historique).

## Monorepo (Nx + pnpm)

```
apps/
  web/                # front React 19 + Vite 8 (PWA, port 4200) — planning, dashboard « ma journée », coût, profil, notifications in-app ; ne parle qu'au BFF ; E2E Playwright (mocké + stack réelle)
  api-gateway/        # BFF NestJS (port 3000) — agrégation /api/v1 orientée écran via clients REST résilients, auth/CORS/rate-limit, OpenAPI ; pacts consumer + E2E API
  svc-foyer/          # foyer, enfants, parents, préférences de notification (port 3002, base 5434) — Postgres (Drizzle), outbox + NATS, API /api/foyers
  svc-referentiel/    # catalogue tarifaire versionné (port 3001, base 5433) — grilles/barèmes, outbox, API /api/grilles
  svc-planification/  # planning multi-modes réel/simulé + contrats & établissements (port 3004, base 5435) — outbox + NATS, API /api/contrats & /api/prestations
  svc-tarification/   # read model + calcul du coût (port 3005, base 5436) — consommateurs idempotents, fallback REST résilient, API /api/couts & /api/couts/annuel
  svc-notifications/  # notifications email (SMTP) + in-app (port 3006, base 5437) — récap hebdo à valider, préférences type×canal, désabonnement RGPD, API /api/validations & /api/moi/notifications
libs/
  shared-kernel/      # value objects purs : Money, Duree, Tranche, DomainError (100% testés)
  contracts/          # contrats décentralisés PAR CONTEXTE (ADR-0004) : kernel/ (enveloppe événement, OpenAPI gateway), foyer/, referentiel/, planification/ — DTO Zod + événements + AsyncAPI
  nest-commons/       # briques NestJS partagées entre services (bootstrap, transverses)
  resilience/         # timeout / retry / circuit-breaker réutilisables (clients REST)
  observability/      # bootstrap OpenTelemetry + options pino corrélées
  shared/
    semaine/          # calcul de semaine ISO partagé (TS pur)
  tarification/
    domain/           # politiques tarifaires PSU/ABCM + consolidation foyer (TS pur, 100% testé)
  foyer/
    domain/           # value objects Foyer/Enfant + tranche dérivée (TS pur, 100% testé)
  referentiel/
    domain/           # versionnement catalogue : PeriodeValidite, sélection applicable (TS pur, 100% testé)
  planification/
    domain/           # génération prestations du mois, planning réel/simulé, état jour de garde (TS pur, 100% testé)
pacts/                # contrats Pact versionnés : api-gateway → svc-foyer / svc-referentiel / svc-planification / svc-tarification / svc-notifications
scripts/              # deploy.mjs (seule voie de livraison), seed-demo.mjs, e2e-stack.mjs, services.json (source unique de la topologie)
docker/               # configs otel-collector, tempo, prometheus, alertmanager, grafana, loki, promtail
docker-compose.yml    # 7 apps + Postgres (×5) + NATS + observabilité (OTel/Tempo/Prometheus/Alertmanager/Grafana/Loki + exporters)
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
> serveur Vite de dev. Ports utilisés par la pile : 3000-3006, 4200, 5433-5437, 4222
> (+ ports d'observabilité, voir `docker-compose.override.yml`).

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
| http://localhost:3006/api/health                                                    | svc-notifications (readiness : Postgres + NATS)    |
| http://localhost:3003                                                               | Grafana (trace distribuée via Tempo)               |

Le `traceparent` W3C est propagé de la gateway vers le service ; les logs JSON pino des
deux services portent le même `trace_id` (corrélation), et la trace est visible dans Grafana/Tempo.
