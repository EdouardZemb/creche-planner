# Crèche Planner — _(futur « Budget du foyer »)_

Application web personnelle pour **planifier les frais de garde** des enfants d'un
foyer et **calculer le coût mensuel consolidé**. Premier lot d'une future
**plateforme de budget familial**. Le dépôt embarque un **jeu de données de
référence fictif** (foyer type à deux enfants, Mia et Zoé).

Deux familles de tarification sont couvertes, sur des **établissements saisis
librement** par le foyer (ils ne sont plus figés dans le code) :

- **Crèche** au barème **PSU/CNAF** — mensualité lissée, compléments horaires à la
  minute, déductions d'absence éligibles.
- **Périscolaire / cantine / ALSH** (grille type **ABCM**) — à la séance et au
  repas, plus les frais annuels, par tranche de revenu fiscal de référence.

Grilles, barème, seuils de tranche et contrats sont **versionnés à date d'effet**
([SFD 30](docs/30-sfd-versionnement-dates-effet.md)) : un mois déjà facturé garde
le tarif de son époque, et une correction rétroactive est un **avenant** explicite.

## Objectif

- Saisir / visualiser le planning par enfant et par mode (crèche, périscolaire,
  cantine, ALSH), et l'**ajuster jour par jour** (heures d'arrivée/départ, absence,
  portée « ce mois » ou durable — [doc 16](docs/16-ajustement-planning.md)).
- Calculer le coût mensuel : mensualité crèche lissée + compléments/déductions, et
  prestations à la séance/au repas + frais fixes.
- Projeter sur l'année, y compris la **transition** crèche → école.
- Tenir le rituel de la semaine : **récap e-mail du mardi**, validation des besoins,
  notifications in-app et préférences par parent.

## État du projet

🚀 **En production** (version `0.16.0`, promue le 2026-08-13) — déployée par
**trains de release** successifs (17 à ce jour) sur un serveur auto-hébergé,
derrière Cloudflare Access
(voir [doc 24](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)).

Les **phases 1 → 12** du plan initial sont **réalisées** : socle distribué, cœur
métier tarifaire pur (100 % couvert, CT-01..20), les 5 services, API Gateway/BFF
(`/api/v1`), interface web React PWA, durcissement & exploitation, navigation/UX,
découplage micro-services, accessibilité **WCAG AA**. S'y ajoutent les chantiers
livrés en continu :

| Chantier                                                                                 | Livré                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications & validation hebdomadaire                                                  | récap e-mail du mardi (rejoué jusqu'à la semaine cible), édition des besoins depuis le mail, in-app, parcours « valider ma semaine »                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Parents du foyer                                                                         | identité Cloudflare Access, isolation par foyer **active en prod**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Établissements en entité libre                                                           | l'annuaire des établissements est saisi par le foyer, l'ancien modèle figé est démantelé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cycle de vie du foyer                                                                    | création / modification / clôture, gardes `@FoyerScope` et `@CreationFoyerUnique`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Tableau de bord « ma journée »                                                           | vue du jour par enfant, absence crèche signalée en deux gestes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Profil parent & préférences de notification                                              | préférences type × canal, désabonnement RGPD (`List-Unsubscribe`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Contrats & besoins, qualité des coûts                                                    | contrat rattaché à l'enfant par référence, écrans de coûts consolidés mensuel/annuel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Versionnement à date d'effet (SFD 30)                                                    | avenants de contrat, historique et correction rétroactive, grilles/barème projetés, écran **Tarifs**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Consolidation UI & qualité                                                               | risques prod (sauvegardes hors-site chiffrées, heartbeat externe, alerte migrations, durcissement conteneurs), outillage de session, découpage des gros composants web, **frontières d'erreur React + remontée des plantages navigateur**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [Standards industriels & RGPD](.claude/plans/plan-standards-industriels.md) (lots 0 → 8) | droits des personnes outillés de bout en bout — **registre des traitements** ([doc 37](docs/37-registre-des-traitements.md)) et page publique `/mentions`, **effacement du foyer** propagé aux read models par événement, **bornes de rétention** avec purge périodique, **export de portabilité** agrégé sur trois services ; format d'erreur unique **`application/problem+json`** (RFC 9457) ; **validation d'environnement au démarrage** (un service refuse de démarrer sur une configuration invalide, en nommant la variable) ; **piste d'audit acteur** des mutations du dossier foyer (`journal_audit` en ajout seul) ; **sémantique HTTP** — en-tête `Location` sur les créations, statut de succès conforme au contrat, écarts restants assumés par écrit ; **durcissement des conteneurs** (CIS Docker) sur les trois piles Compose et **quarantaine de 3 jours** avant d'installer une version npm fraîchement publiée |

L'état d'avancement détaillé (**source de vérité**) vit en
[doc 06](docs/06-etat-davancement.md) ; le plan initial en
[doc 05](docs/05-plan-de-developpement.md) (document historique). Le découpage du
chantier courant vit dans [`.claude/plans/`](.claude/plans/), et les faits durables
(état de prod, pièges tranchés) dans [`.claude/memory/`](.claude/memory/).

## Documentation de pilotage

Toute la conception vit dans [`docs/`](docs/) et **précède** le code.
**→ [Index complet de la documentation](docs/README.md)** (par thème et par
besoin) ; pour contribuer : [CONTRIBUTING.md](CONTRIBUTING.md) +
[CONVENTIONS.md](CONVENTIONS.md). Les incontournables :

| Doc                                                                                                          | Contenu                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — Spécification fonctionnelle](docs/01-spec-fonctionnelle.md)                                            | Périmètre, acteurs, user stories, règles métier, critères d'acceptation                                                                                                                                                                                                                                       |
| [02 — Modèle de coût (PSU/CNAF)](docs/02-modele-de-cout.md)                                                  | Formules, glossaire, invariants, jeu de cas de test chiffrés                                                                                                                                                                                                                                                  |
| [03 — Standards de développement](docs/03-standards-developpement.md)                                        | Clean code, SOLID, hexagonal, conventions, tests, Git, CI                                                                                                                                                                                                                                                     |
| [04 — Architecture & technologies](docs/04-architecture-et-technos.md)                                       | Comparatif techno, choix justifiés, découpage en **microservices**                                                                                                                                                                                                                                            |
| [05 — Plan de développement](docs/05-plan-de-developpement.md)                                               | Phases, jalons, lotissement, definition of done                                                                                                                                                                                                                                                               |
| [06 — État d'avancement & reprise](docs/06-etat-davancement.md)                                              | **Source de vérité de l'avancement** : phases livrées, features, arborescence, commandes, conventions, guide de reprise                                                                                                                                                                                       |
| [20 — Plan de test](docs/20-plan-de-test.md) · [21 — Politique de test](docs/21-politique-strategie-test.md) | Niveaux de test, couverture attendue, gestion des anomalies                                                                                                                                                                                                                                                   |
| [24 — Déploiement & exploitation](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)                   | Production : portes de déploiement, topologie pull-based, runbooks (dossier [`docs/exploitation/`](docs/exploitation/))                                                                                                                                                                                       |
| [30 — Versionnement à date d'effet](docs/30-sfd-versionnement-dates-effet.md)                                | Avenants, grilles/barèmes versionnés, passé immuable — socle des SFD 31 → 33 (à l'étude)                                                                                                                                                                                                                      |
| [34 — Registre d'améliorations](docs/34-registre-ameliorations.md)                                           | **Boucle d'amélioration** : pistes `AM`, leçons `LE`, motifs `MO`, empêchements `EM` — plus l'**inventaire des portes**, avec ce que chacune ne couvre pas et sa sonde négative                                                                                                                               |
| [37 — Registre des traitements](docs/37-registre-des-traitements.md)                                         | **RGPD** : traitements, tiers, durées de conservation et classement des tables (exporté / copie / technique) — adossé à [ADR-0007](docs/adr/0007-exemption-domestique-et-demarche-volontaire.md)                                                                                                              |
| [ADR](docs/adr/)                                                                                             | 0001 → 0008 : microservices · grain des services & politiques tarifaires · toolchain · décentralisation des contrats · registre de contrats · préférences de notification · **exemption domestique & démarche volontaire** (RGPD) · **écarts de sémantique HTTP** assumés (pagination, concurrence optimiste) |

## Architecture (résumé)

**Microservices** (TypeScript de bout en bout) — 5 services + gateway + web :
`svc-foyer`, `svc-referentiel` (catalogue tarifaire), `svc-planification`,
`svc-tarification`, `svc-notifications` (email + in-app). Base par service,
communication REST + événements (NATS), API Gateway/BFF, **front React PWA
(`apps/web`) qui ne parle qu'au BFF**. Hexagonal + SOLID à l'intérieur de chaque
service ; contrats **décentralisés par contexte** (`libs/contracts/*`, ADR-0004/0005).
Calcul multi-modes via stratégies `PolitiqueTarifaire`. Détails en docs 04 + ADR.

## Monorepo (Nx + pnpm)

```
apps/
  web/                # front React 19 + Vite 8 (PWA, port 4200) — accueil, dashboard « ma journée », planning, contrats, coûts, établissements, tarifs, profil, notifications in-app, page publique `/mentions` ; ne parle qu'au BFF ; E2E Playwright (mocké + stack réelle) + non-régression visuelle
  api-gateway/        # BFF NestJS (port 3000) — agrégation /api/v1 orientée écran via clients REST résilients (foyers, contrats, couts, etablissements, notifications, moi, desabonnement, erreurs-client), auth/CORS/rate-limit, OpenAPI, **erreurs `application/problem+json` (RFC 9457)** traduites au bord ; pacts consumer + E2E API
  svc-foyer/          # foyer, enfants, parents, préférences de notification, seuils de tranche versionnés (port 3002, base 5434) — Postgres (Drizzle), outbox + NATS, API /api/foyers ; effacement du foyer (cascade + événement d’intégration) et export de portabilité
  svc-referentiel/    # catalogue tarifaire versionné (port 3001, base 5433) — grilles/barèmes, publication de grille, outbox, API /api/grilles
  svc-planification/  # planning multi-modes réel/simulé, contrats versionnés + avenants, établissements (port 3004, base 5435) — outbox + NATS, API /api/contrats, /api/prestations & /api/etablissements
  svc-tarification/   # read model + calcul du coût (port 3005, base 5436) — consommateurs idempotents, projection des grilles et du barème, fallback REST résilient, API /api/couts & /api/couts/annuel
  svc-notifications/  # notifications email (SMTP) + in-app (port 3006, base 5437) — récap hebdo à valider et son rejeu, préférences type×canal, désabonnement RGPD, API /api/validations & /api/moi/notifications
libs/
  shared-kernel/      # value objects purs : Money, Duree, Tranche, DomainError + socle d'entité versionnée (PeriodeValidite, sélection de version) — 100% testé
  contracts/          # contrats décentralisés PAR CONTEXTE (ADR-0004) : kernel/ (enveloppe événement, OpenAPI gateway), foyer/, referentiel/, planification/, notifications/ — DTO Zod + événements + AsyncAPI
  nest-commons/       # briques NestJS partagées entre services (bootstrap, base, santé, mailer, messaging, outbox, sécurité, configuration d’environnement validée, purge des rétentions)
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
scripts/              # deploy.mjs (seule voie de livraison), pollers de release/staging, sauvegardes + restauration, seed-demo.mjs, e2e-stack.mjs, preflight.mjs, les vérificateurs des portes (frontieres, pieges, liens, faits, readme, statuts, tracabilite, registre, retentions, portabilite, acteur, problemes, environnement, empechements), comparer-empreinte.mjs, services.json (source unique de la topologie)
docker/               # configs otel-collector, tempo, prometheus, alertmanager, grafana, loki, promtail
docker-compose.yml    # 27 services : 7 apps + Postgres (×5) + NATS + observabilité (OTel/Tempo/Prometheus/Alertmanager/Grafana/Loki/Promtail) + 7 exporters
                      # les ports ne sont publiés QUE par docker-compose.override.yml (dev/CI) ; la prod n'expose que Caddy
```

**Frontières de modules** vérifiées au lint (`@nx/enforce-module-boundaries`) sur deux
axes : `type:*` (hexagonal : domain → application → infrastructure) et `context:*`
(isolation des bounded contexts ; seule passerelle inter-contextes : `libs/contracts`).
La cohérence entre les tags Nx et les `depConstraints` est **outillée** :
`pnpm frontieres` (cf. [CONVENTIONS.md §4](CONVENTIONS.md)).

## Démarrer

Prérequis : **Node 24 LTS** (figé dans [`.nvmrc`](.nvmrc)), **pnpm 10.34.2 via
corepack**, **Docker Desktop** (seulement pour la pile locale et les e2e stack).
Détail et commandes de tous les jours : [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
corepack pnpm install

# Vérifie l'environnement de session (~6 s, hors réseau) et NOMME ce qui manque
corepack pnpm preflight

# Qualité : lint + type-check + tests + build (couverture sous ratchet)
corepack pnpm check          # = nx run-many -t lint typecheck test build

# Portes rapides, aussi jouées par le job `ci`
corepack pnpm frontieres     # frontières Nx & vocabulaire partagé
corepack pnpm pieges         # pièges morts recopiés dans un plan ou une doc
corepack pnpm registre       # registre d'améliorations : formes, preuves, compteurs
corepack pnpm environnement  # inventaire des variables d'environnement lues

# Front web en dev (Vite, HMR) — proxifie /api vers la gateway :3000
corepack pnpm nx serve web   # http://localhost:4200

# Toute la pile locale (web + services + Postgres + NATS + observabilité)
docker compose up --build
```

### Tests E2E sur stack réelle

En plus de l'E2E **mocké** rapide (`apps/web/e2e/parcours.e2e.spec.ts`), un étage **E2E sur la pile
réelle** rejoue les parcours critiques (foyer → contrats, planning crèche, planning ABCM, coût
consolidé, ajustement de planning) contre la stack dockerisée, **sans aucun mock réseau**.

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

Une refonte de style se relit en plus avec `pnpm nx run web:e2e-visuel` puis
`node scripts/comparer-empreinte.mjs` (empreinte des styles calculés, hors CI —
outil de revue, pas une porte ; limites décrites dans [CONTRIBUTING.md](CONTRIBUTING.md)).

Une fois la pile levée :

| URL                                                                                 | Rôle                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| http://localhost:4200                                                               | **Front web (React PWA)** — saisie, planning, coût |
| http://localhost:3000/api/health                                                    | Gateway (readiness : les 5 amonts prêts)           |
| http://localhost:3000/api/openapi.json                                              | Spécification OpenAPI du BFF (route publique)      |
| http://localhost:3000/api/referentiel/health                                        | Parcours distribué gateway → svc-referentiel → DB  |
| http://localhost:3000/api/v1/foyers (POST)                                          | BFF : créer un foyer + ses enfants (agrégation)    |
| http://localhost:3000/api/v1/contrats (POST)                                        | BFF : créer un contrat de garde                    |
| http://localhost:3000/api/v1/couts?foyer=&lt;uuid&gt;&mois=2026-10                  | BFF : coût consolidé du mois (lecture agrégée)     |
| http://localhost:3000/api/v1/notifications/a-valider                                | BFF : les semaines qui attendent une validation    |
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
Les plantages du navigateur remontent par `POST /api/v1/erreurs-client` et sont lisibles dans Loki.

## Qualité & CI

`main` est protégée : une branche par sujet, une PR, et le check **`ci`** vert
(détail du workflow PR dans [CONTRIBUTING.md](CONTRIBUTING.md)). Le job `ci` joue
`nx affected` (lint, type-check, tests, build) puis les portes qui empêchent une
régression silencieuse :

- **couverture sous ratchet** (AQ-06) : seuils vitest par projet, plus une
  comparaison à la baseline glissante de `main` — un projet qui perd plus de
  0,5 pt de couverture lignes échoue (`coverage-compare.mjs`) ;
- **warnings ESLint** figés dans `lint-baseline.json` (aucun ajout accepté) ;
- **documentation** : `pnpm liens` (liens internes et ancres), `pnpm faits` (les
  valeurs citées confrontées à leur source), `pnpm readme` (la **fraîcheur de ce
  document** : portes câblées en CI, ADR présents, lots livrés du chantier en
  cours, sous-dossiers de `docs/`), `pnpm statuts` (statut daté de chaque
  document), `pnpm tracabilite` (exigences `CT`/`UT` ↔ tests, dans les deux
  sens) et `pnpm registre` (forme, preuves et compteurs de
  [doc 34](docs/34-registre-ameliorations.md)), cf.
  [doc 35](docs/35-politique-documentation.md) ;
- **portes de conception** — chacune confronte un écrit à son code, avec un
  attendu **dérivé** de la source plutôt que recopié : `pnpm retentions` (une
  durée de conservation déclarée nomme sa colonne, et cette colonne existe),
  `pnpm portabilite` (toute table est classée, et une table dite exportée est
  réellement lue), `pnpm acteur` (toute route de mutation est classée, et une
  route auditée nomme une action réellement consignée), `pnpm problemes` (le
  registre des codes d'erreur métier), `pnpm environnement` (aucune lecture de
  `process.env` hors configuration, aucun réglage de compose inerte),
  `pnpm conteneurs` (chaque service des trois piles Compose tourne en
  `no-new-privileges` + `cap_drop: [ALL]`, racine en lecture seule sauf exemption
  motivée, chaque capacité reprise nommée), `pnpm quarantaine` (le délai avant
  d'installer une version npm fraîchement publiée est déclaré là où il est effectivement lu,
  et accordé au _cooldown_ de Dependabot) et `pnpm empechements` ;
- **dérive de contrats** : `pact-drift`, `pact-can-i-deploy`, types OpenAPI du
  front régénérés et comparés à l'octet ;
- **E2E** web mocké, smoke stack et E2E stack réelle sur les images affectées ;
- **sécurité** : Trivy (image + fs), CodeQL, Semgrep, scan de secrets, plus deux
  veilles **quotidiennes** — les alertes ouvertes (CodeQL/Dependabot), et un
  **re-scan CVE des images déjà déployées** qui dit, pour chaque vulnérabilité,
  si le correctif est **déjà en source** (un redéploiement suffit) ou reste à
  écrire ;
- **hors CI bloquante** : mutation testing Stryker sur les libs domaine
  (hebdomadaire, seuil 80 %) et métriques DORA depuis l'historique des
  déploiements.

## Déploiement

`node scripts/deploy.mjs` est la **seule voie de livraison** : la prod **tire** les
images GHCR immuables (`ghcr.io/edouardzemb/creche-planner/<svc>:<version>`),
vérifie la signature cosign des 7 images, puis franchit ses portes dans l'ordre
(pull → `up --wait` → readiness, seed idempotent, smoke de perf) avec **rollback
automatique** ; les migrations sont appliquées au boot par le migrateur embarqué de
chaque service. Un poller déclenche le déploiement dès qu'un train de release
est publié. Coupe de version par `nx release` (une version par service applicatif).
Topologie, portes et runbooks : [doc 24](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)
et [`docs/exploitation/`](docs/exploitation/).
