# 05 — Plan de développement

> ⚠️ **Document historique** (plan initial des phases 1→12). L'état réel du
> projet et le guide de reprise vivent en **[doc 06](06-etat-davancement.md)** —
> en cas de divergence, la doc 06 fait foi. (AQ-16, doc 27.)

> Statut : **Historique** · Version 0.5 · 2026-06-03
> Adapté à l'archi **microservices** (doc 04 v0.3 : 4 services) et au périmètre
> **multi-modes** (crèche PSU + ABCM péri/cantine/ALSH). Lotissement par incréments
> livrables : chaque lot finit sur quelque chose qui _tourne_ et est _testé_.

## Principe : _walking skeleton_ distribué d'abord

On câble tôt un parcours minimal **traversant le réseau** (web → gateway →
1 service → DB → réponse) pour valider la plomberie microservices, **avant** d'y
mettre la logique métier. On valide ensuite le **cœur de calcul PSU** (le plus
risqué fonctionnellement) en isolation.

## Phase 0 — Cadrage _(✅ validée)_

- [x] Spec fonctionnelle (doc 01)
- [x] Modèle de coût + cas de test (doc 02)
- [x] Standards de dev (doc 03)
- [x] Architecture microservices & technos (doc 04, v0.2)
- [x] Décision archi : **microservices** (ADR-0001)
- [x] **Validation finale des docs**
- [~] Questions `Q-05/Q-08/Q-11` encore ouvertes (non bloquantes — défauts assumés ; `Q-05` traité côté Foyer, `Q-08` consommé par la Planification, `Q-11` reporté en Phase 6)

## Phase 1 — Socle technique distribué _(✅ réalisée — 2026-06-02)_

**But** : la plomberie microservices tourne en local, vide mais saine. **Atteint.**

- [x] Monorepo Nx + pnpm, TS strict, ESLint/Prettier + **frontières de modules**, Husky.
- [x] `libs/shared-kernel` (`Money`, `Duree`, `Tranche`, `DomainError`) — **100 % testé en TDD**.
- [x] `libs/contracts` : structure OpenAPI/AsyncAPI + DTO Zod + enveloppe d'événements.
- [x] Squelettes NestJS : `api-gateway` + `svc-referentiel` avec `/health`, Postgres dédié (Drizzle), **NATS** branché.
- [x] **OpenTelemetry** (trace id propagé gateway→service), logs pino corrélés (+ `libs/observability`).
- [x] `docker-compose` (services + Postgres + NATS + collecteur OTel + Tempo + Prometheus + Grafana) ; CI Nx affected.
- [x] **DoD validée** : `gateway→svc-referentiel→/health→DB` répond (`status: ok`) ; trace distribuée à 2 services visible dans Tempo/Grafana ; `nx run-many -t lint typecheck test build` vert.

> 📌 **État détaillé, arborescence, commandes et décisions techniques** : voir [doc 06](06-etat-davancement.md) et [ADR-0003](adr/0003-decisions-de-toolchain.md). Point de départ Phase 2 ci-dessous.

## Phase 2 — Cœur métier : politiques tarifaires (TDD, en isolation) _(✅ réalisée — 2026-06-02)_

**But** : reproduire **exactement** les chiffres réels, sans réseau. **Atteint.**

- [x] `libs/tarification/domain` (tags `type:domain`, `context:tarification`) : port
      `PolitiqueTarifaire` + stratégies `TarifCrechePsu`, `TarifPeriscolaireAbcm`,
      `TarifCantineAbcm`, `TarifAlshAbcm`, `FraisFixesAbcm` (+ `UnitesAssociativesAbcm`) ;
      consolidation `consoliderCoutMoisFoyer` ; agrégats `CoutMois`/`LigneDeCout`.
- [x] Invariants doc 02 §5 portés par des erreurs typées (`TauxEffortInconnuError`,
      `QuantiteInvalideError`, `GrilleIndisponibleError`, `DeductionExcessiveError`) au-dessus
      de `shared-kernel` (`Money`, `Duree`, `Tranche`).
- [x] Cas **CT-01..CT-14 + CT-20** (oracle doc 02 §6) écrits d'abord puis verts ;
      bonus CT-15..CT-18 (UA, réservé=facturé, PAI) également couverts. **55 tests.**
- [x] **DoD validée** : **100 % de couverture** du domaine `tarification` ;
      tous les CT verts (pur, hors infra) ; `lint typecheck test build` vert sur les 6 projets.

## Phase 3 — Service Foyer _(✅ réalisée — 2026-06-02)_

**But** : socle partagé (composition + finances). **Atteint.**

- [x] `libs/foyer/domain` (tags `type:domain`, `context:foyer`) : value objects `Foyer`/`Enfant`,
      invariants (≥ 1 enfant à charge, nb parts > 0, RFR/ressources ≥ 0 via `Money`),
      `tranche` dérivée par `Tranche.depuisRfr` — **TS pur, 100 % couvert en TDD (19 tests)**.
- [x] `apps/svc-foyer` : Postgres dédié (Drizzle, migration `foyer`/`enfant`/`outbox` appliquée au boot),
      **outbox transactionnelle** + relais NATS JetStream idempotent (`Nats-Msg-Id`), API REST
      `/api/foyers` & `/api/foyers/:id/enfants`. Port 3002, base `foyer:5434`.
- [x] Événements `foyer.FoyerMisAJour.v1` & `foyer.EnfantAjoute.v1` (Zod, dans `libs/contracts`),
      écrits dans l'outbox **dans la transaction** du changement d'état, publiés par le relais.
- [x] **Contrat Pact** : consommateur `api-gateway` (pact versionné `pacts/`) vérifié côté provider
      `svc-foyer` (boot du bundle + base réelle, `stateHandlers`) — **bloquant en CI** (service Postgres).
- [x] **DoD validée** : `nx run-many -t lint typecheck test build` vert sur les 8 projets ;
      tranche **T3** déduite du RFR 72 705 € (testée domaine + contrat).

## Phase 4 — Service Référentiel (catalogue tarifaire) _(✅ réalisée — 2026-06-02)_

**But** : owner des barèmes/grilles versionnés. **Atteint.**

- [x] `libs/referentiel/domain` (tags `type:domain`, `context:referentiel`) :
      `PeriodeValidite`, `ModeGarde`, `trancheDepuisNiveau`, sélection de version
      applicable + garde anti-chevauchement — **TS pur, 100 % couvert (28 tests)**.
- [x] `svc-referentiel` enrichi : tables versionnées (`grille_abcm`, `bareme_psu`,
      `frais_fixes_abcm`, `jour_non_facturable`, `outbox`), migration appliquée au
      boot, **seed des données de référence 2026** (doc 02 §4, idempotent), **outbox
      transactionnelle** + relais NATS JetStream (stream `REFERENTIEL`). Port 3001,
      base `referentiel:5433`.
- [x] API **« grille applicable à (date, tranche, mode) »** (`GET /api/grilles/applicable`),
      publication `POST /api/grilles/abcm`, frais fixes et jours non facturables.
- [x] Événement `referentiel.GrillePubliee.v1` (Zod, dans `libs/contracts`), émis
      **par mode ABCM** dans l'outbox lors d'une publication.
- [x] **Contrat Pact** : consommateur `api-gateway` (pact versionné `pacts/`) vérifié
      côté provider `svc-referentiel` (boot du bundle + base réelle, `stateHandlers`) —
      **bloquant en CI** (service Postgres dédié `postgres-referentiel`).
- [x] **DoD validée** : `nx run-many -t lint typecheck test build` vert sur les **9 projets** ;
      cantine **T3 2026 = 12,68 €** servie par l'API (testée domaine + contrat Pact).

## Phase 5 — Service Planification (multi-modes) _(✅ réalisée — 2026-06-03)_

**But** : planning des activités de garde par enfant. **Atteint.**

- [x] `libs/planification/domain` (tags `type:domain`, `context:planification`) : `SemaineType`/
      `PlageHoraire`, `ContratCreche` (mensualité lissée), `InscriptionAbcm` (cantine/péri/ALSH),
      génération des **« prestations du mois »** (quantités), planning **simulé** (`calculerDeltaPlanning`),
      calendrier (`joursDuMois`, `estJourOuvertureEcole`) — **TS pur, 100 % couvert (65 tests)**.
- [x] `apps/svc-planification` (dupliqué de `svc-foyer`) : **port 3004**, base dédiée `planification:5435` ;
      tables `contrat`, `planning_mois` (réel **et** simulé, discriminant `simule`), `outbox` ; migration
      `0000_planification_initial` appliquée au boot.
- [x] API (préfixe `/api`) : `POST /api/contrats`, `PUT /api/contrats/:id/plannings/:mois?simule=`,
      `GET /api/prestations?contrat&mois&simule` (**cœur DoD** : génère les prestations en excluant les
      **jours non facturables** consommés du Référentiel via `GET /api/calendrier/jours-non-facturables`).
- [x] Événements `planification.ContratCree.v1` & `planification.PlanningModifie.v1` (Zod, dans
      `libs/contracts`), écrits dans l'**outbox transactionnelle** + relais NATS JetStream (stream
      `PLANIFICATION`, dédup `Nats-Msg-Id`).
- [x] **Contrat Pact** : consommateur `api-gateway` (pact versionné `pacts/`) vérifié côté provider
      `svc-planification` (boot du bundle + base réelle, `stateHandler`) — **bloquant en CI** (service
      Postgres dédié `postgres-planification`).
- [x] **DoD validée** : `nx run-many -t lint typecheck test build` vert sur les **11 projets** ;
      crèche Mia 126,50 h/mois & Zoé 118,79 h/mois (CT-02/03), cantine 16 j (CT-10), péri soir×12 +
      matin×8 (CT-11), ALSH 5 j (CT-12) servis par les prestations du mois.

## Phase 6 — Intégration Tarification (distribué) _(✅ réalisée — 2026-06-03)_

**But** : le calcul devient un service autonome et résilient. **Atteint.**

- [x] `apps/svc-tarification` : **port 3005**, base dédiée `tarification:5436` ; **read model**
      (`foyer`/`enfant`/`grille_tarifaire`/`contrat`/`prestation_mois`/`processed_event`) alimenté
      par les streams `FOYER`/`REFERENTIEL`/`PLANIFICATION` ; migration appliquée au boot.
- [x] **Consommateurs JetStream idempotents** : consommateurs **durables** par stream, dédup
      transactionnelle via `processed_event` (rejeu at-least-once = no-op), bornage des re-livraisons
      (`max_deliver` + `backoff` escaladé) contre le livelock d'un événement orphelin.
- [x] **Fallback synchrone résilient** : clients REST `svc-planification`/`svc-referentiel` avec
      **timeout/retry/circuit-breaker** si une projection est froide ou incomplète.
- [x] Calcul réutilisant `libs/tarification/domain` (politiques PSU/ABCM) + `consoliderCoutMoisFoyer` ;
      API `GET /api/couts` (mois, par enfant/mode, consolidé foyer) & `GET /api/couts/annuel`
      (transition crèche → école, frais fixes de septembre).
- [x] **Contrat Pact** : consommateur `api-gateway` (pact versionné `pacts/api-gateway-svc-tarification.json`)
      vérifié côté provider `svc-tarification` (boot du bundle + base réelle via `TARIFICATION_DATABASE_URL`,
      `stateHandlers`) — **bloquant en CI** (service Postgres dédié `postgres-tarification`).
- [x] **DoD validée** : `nx run-many -t lint typecheck test build` vert sur les **12 projets** ;
      CT-04/CT-10/CT-11/CT-20 reproduits via le chemin distribué complet (CT-10 cantine octobre 2026 = **20 288 c**).

## Phase 7 — API Gateway / BFF _(✅ réalisée — 2026-06-03)_

**But** : une API orientée écran pour le front. **Atteint.**

- [x] `apps/api-gateway` enrichi (port 3000) : **agrégation multi-services** sous **`/api/v1`**
      (`POST /api/v1/foyers` orchestre foyer+enfants, `POST /api/v1/contrats`, `PUT …/plannings/:mois`,
      `GET /api/v1/couts` & `/couts/annuel`) via des **clients REST résilients** (timeout/retry/
      circuit-breaker, pattern repris de `svc-tarification`, propagation des erreurs en BFF).
- [x] **Transverses faits main** (aucune dépendance ajoutée) : **auth par token** Bearer (`@Public()`
      pour health/openapi ; désactivée si `GATEWAY_TOKEN` absent), **CORS** configurable, **rate-limit**
      en mémoire (fenêtre glissante, 429), **versionnage URI** (`/v1` ; transverses neutres `/api/…`).
- [x] **OpenAPI publié** : document 3.1 versionné dans `libs/contracts`, servi par `GET /api/openapi.json`.
- [x] **Contrats Pact (consumer)** étendus aux **écritures** (POST foyer/enfant/contrat) ; les vérifs
      provider restent **bloquantes en CI** (inchangées : aucun nouveau `stateHandler` requis).
- [x] **DoD validée** : test **E2E API** « créer foyer+contrats → lire le coût du mois » de bout en bout
      (bundle réel spawné + services aval simulés, CT-10 = 20 288 c.) ; `nx run-many -t lint typecheck
test build` vert sur les **12 projets** ; `format:check` OK.

## Phase 8 — Interface web _(✅ réalisée — 2026-06-03)_

**But** : outil utilisable au quotidien. **Atteint.**

- [x] `apps/web` : front **React 18 + Vite PWA** (port **4200**), câblé à la main (config ESLint legacy),
      tags `type:app`/`context:web` ; ne parle **qu'au BFF** (`/api/v1`), types BFF écrits à la main,
      état via hooks + `fetch` (zéro lib de state), auth Bearer optionnelle (`VITE_GATEWAY_TOKEN`).
- [x] Saisie foyer/contrats ; **calendrier mensuel** par enfant et par mode (FullCalendar, vue mensuelle).
- [x] Crèche : jours gardés (semaine-type), marquage **absence** (préavis/certificat) + **complément**.
- [x] ABCM : **cantine** (PAI), **péri** (matin/soir via semaine-type), **ALSH** par jour (complète/demi + repas).
- [x] Panneau **coût du mois** (détail par prestation, lignes débit/crédit) + **vue annuelle** +
      **mode simulation** (`?simule=true`, **delta €** réel vs simulé).
- [x] **PWA installable** (manifest + service worker via vite-plugin-pwa).
- [x] **DoD validée** : **E2E Playwright** « créer foyer + contrat → planifier un mois → lire le coût
      consolidé » vert (BFF mocké par interception réseau, offline) ; run-many `lint typecheck test build`
      vert sur les **13 projets** ; `format:check` OK.
- [x] Service `web` ajouté au `docker-compose` (nginx, proxy `/api`) ; job `e2e-web` (chromium) en CI.

## Phase 9 — Durcissement & exploitation _(✅ réalisée — 2026-06-04)_

- Résilience : BFF 502 propre + **rendu d'erreur lisible côté front** (chaos réel à valider sous Docker).
- Dashboards Grafana (services/latence/**lag JetStream**) + alertes Prometheus de base.
- Sauvegardes par base (scripts PS/bash) + runbook de déploiement ; manifests Kubernetes (option) **non livrés**.
- Export CSV/PDF récap ; a11y & responsive.
- Bugs backlog corrigés : prestations filtrées par période de validité ; CRUD contrat de bout en bout.

➡️ Détail tel que livré : [doc 06 → §14](06-etat-davancement.md). `nx run-many` vert sur les 13 projets.

## Phase 10 — Refonte navigation & UX/UI _(✅ réalisée — 2026-06-04)_

**But** : faire passer le front de _« fonctionne »_ à _« fiable et agréable au quotidien »_,
sans toucher au calcul ni à l'architecture. Déclenchée par un **audit en lecture seule**
(2026-06-04, 3 agents : navigation, design visuel/CSS, accessibilité) qui a relevé des
impasses de navigation, une désynchronisation d'état URL ↔ `localStorage`, des fonctions
métier inaccessibles au clavier, et un système de design embryonnaire (≈ 90 % de style inline).

- Spec dédiée : [doc 07 — Spécification UX, navigation & interface](07-spec-ux-navigation.md)
  (exigences EX-01..16, critères d'acceptation).
- Plan d'exécution : [doc 08 — Plan d'implémentation UX](08-plan-implementation-ux.md), découpé
  en **7 lots à fichiers disjoints** lancés dans des **sessions indépendantes** (Lot 1 fondation
  séquentiel → lots 2-6 parallèles → lot 7 polish/intégration).
- **Front-only** (`apps/web/src`) : aucune modification de service/domaine/contrat d'API, aucune
  dépendance npm nouvelle, interfaces de props stables.
- [x] **DoD validée** : CA des EX couverts par des tests ; `nx run-many -t lint typecheck test
build` vert sur les 13 projets ; **136 tests web** ; E2E Playwright `apps/web` vert ; parcours
      clavier complet ; zéro libellé non accentué / date ISO / mode brut à l'écran.

## Phase 11 — Découplage & maturité micro-services _(✅ réalisée — 2026-06-05)_

**But** : porter le découplage de _« fort sur le code/données »_ à _« fort sur les contrats et la
chaîne de livraison »_, sans rien changer au comportement métier. Déclenchée par un **audit
d'architecture en lecture seule** (2026-06-04, 2 agents : maturité micro-services & analyse de
couplage) — maturité **84/100**, qualité du découplage **92/100**, mais **couplage de contrat
centralisé** (`libs/contracts`), versioning `.v1` cosmétique, livraison coordonnée (`0.0.1` figé),
repli sync non instrumenté.

- Décision structurante : [ADR-0004 — Décentralisation des contrats](adr/0004-decentralisation-des-contrats.md)
  (révise le principe « passerelle de contrats unique » de l'ADR-0001) ;
  [ADR-0005 — Registre de contrats](adr/0005-registre-de-contrats.md) (pacts fichiers + `can-i-deploy`).
- Spec dédiée : [doc 09 — Spec découplage & maturité micro-services](09-spec-decouplage-microservices.md)
  (exigences DEC-01..10, critères d'acceptation).
- Plan d'exécution : [doc 10 — Plan d'implémentation découplage](10-plan-implementation-decouplage.md),
  découpé en **7 lots à fichiers disjoints** (Lot A fondation contrats séquentiel → lots B-F
  parallèles → lot G intégration). Réalisé par **agents parallèles** (méthode doc 06 §16.3).
- **Comportement gelé** : aucun changement de calcul/API/événement observable ; **pacts inchangés**.
- [x] **DEC-01** `libs/contracts` éclatée en `contracts-kernel` + `contracts-{foyer,referentiel,
planification}` tagués `context:<X>` ; fan-in de contrat 5 → 2 par contexte ; frontière par
      tag prouvée par un test négatif. **DEC-10** contraintes ESLint mortes retirées.
- [x] **DEC-02** versioning exercé : `foyer.FoyerMisAJour.v2` rétrocompatible + dispatch par
      version côté consommateur + tests de rétro-compatibilité.
- [x] **DEC-03** `apps/web` typé contre l'OpenAPI gateway (dérivation au niveau type, zéro dépendance
      externe) ; une divergence casse `web:typecheck`.
- [x] **DEC-04** `nx release` par projet (independent) ; **DEC-06** CI image-par-service via
      `nx affected` + garde `can-i-deploy` (ADR-0005) ; runbook de déploiement isolé.
- [x] **DEC-08** lib partagée `@creche-planner/resilience` (fin de la duplication) ; **DEC-09**
      `Dockerfile` multi-stage par service ; **DEC-07** garde-fou de pureté du `shared-kernel`.
- [~] **DEC-05** repli tarif→planif **instrumenté** (compteur + dashboard Grafana + alerte) ;
  **suivi** : le pipeline **métriques** OTel→Prometheus reste à câbler de bout en bout (la
  métrique est émise et les tableaux/alertes provisionnés, mais non encore scrappés — cf.
  [doc 06 §17](06-etat-davancement.md)).
- [x] **DoD** : `nx run-many -t lint typecheck test build` **vert sur les 17 projets** ; E2E API
      « créer foyer+contrats → coût » vert ; pacts **inchangés** (vérifs consumer vertes).

## Phase 12 — Accessibilité AA & utilisabilité (CT-UT) _(✅ réalisée — 2026-06-05)_

**But** : atteindre un **WCAG 2.1 AA** crédible et lever les irritants d'utilisabilité, sans
toucher au calcul ni aux contrats. Déclenchée par un **audit d'utilisabilité statique** au prisme
**ISTQB® CT-UT** (2026-06-04) — score **82/100**, **WCAG A atteint / AA quasi atteint** : deux
écarts structurants (pattern `tablist` incomplet, pas de focus au changement de route) + irritants
(`window.confirm` natif, messages d'erreur non actionnables, absences perdues au changement de
mois) + un **bug fonctionnel** (colonne ALSH écrivant dans `cantine`).

- Spec dédiée : [doc 11 — Spec accessibilité & utilisabilité CT-UT](11-spec-accessibilite-ct-ut.md)
  (exigences UT-01..10, sévérités Nielsen, critères d'acceptation).
- Plan d'exécution : [doc 12 — Plan d'implémentation accessibilité](12-plan-implementation-accessibilite.md),
  découpé en **7 lots à fichiers disjoints** (Lot 1 fondation a11y séquentiel → lots 2-6
  parallèles → lot 7 intégration + axe-core).
- **Front-only** (`apps/web/src`) : aucune modification de service/domaine/contrat d'API, aucune
  dépendance npm nouvelle, interfaces de props stables.
- **Réalisée par agents parallèles** (méthode doc 06 §16.3) : Lot 1 fondation séquentiel
  (`Abbr`, `glossaire`, `ModaleConfirmation`, `useAnnonceRoute`, `usePersistanceAbsences`) →
  lots 2-6 parallèles à fichiers disjoints → intégration centralisée. Détail [doc 06 §18](06-etat-davancement.md).
- [x] **UT-01** motif onglets ARIA complet (`tab`/`tabpanel`/`aria-controls` + flèches + roving
      tabindex) ; **UT-02** focus + annonce live au changement de route. **Les deux échecs structurants AA levés.**
- [x] **UT-03** `window.confirm` remplacé par `ModaleConfirmation` (focus initial « Annuler ») ;
      **UT-04** messages d'erreur orientants + focus porté ; **UT-05** liaison erreur↔champ
      `nbEnfantsACharge` ; **UT-06** noms accessibles des boutons « Retirer ».
- [x] **UT-07** absences persistées par (contrat, mois) + saisie en lot accessible au clavier ;
      **UT-08** sigles (RFR/PSU/ABCM/ALSH) explicités via `Abbr`/`glossaire` ; **UT-09** repère
      non coloré du delta (▲/▼/=).
- [x] **UT-10** bug ALSH corrigé (n'écrit plus dans `cantine`) ; **écart amont documenté** : le
      champ ALSH n'existe pas dans le DTO `InscriptionsJour` (correction **front** sans toucher le contrat).
- [x] **DoD CI** : `nx run-many -t lint typecheck test build` **vert sur `web`** (206 tests) ;
      front-only ⇒ services/pacts **inchangés**.
- [x] **Lot 7 — audit runtime exécuté** (2026-06-05) : audit **axe-core** (`@axe-core/playwright`)
      sur l'app servie → **0 violation WCAG 2.1 AA** sur 6 routes (accueil, foyer, contrats, planning,
      coûts mensuels/annuels) ; **E2E Playwright 8/8 vert** (parcours + a11y) ; spec
      `apps/web/e2e/a11y.e2e.spec.ts`. Revue **clavier + lecteur d'écran** (NVDA/VoiceOver) : runbook
      actionnable livré dans [doc 13](13-validation-accessibilite-runtime.md) (à dérouler par un humain).

## Jalons

| Jalon    | Livrable démontrable                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| M1 (P1)  | Plomberie microservices qui tourne + trace distribuée + CI verte                   |
| M2 (P2)  | Calcul conforme au réel (crèche + ABCM, CT-01..20), en isolation                   |
| M3 (P6)  | Coût consolidé calculé via le chemin distribué complet (événements)                |
| M4 (P7)  | API de bout en bout via le BFF                                                     |
| M5 (P8)  | Outil web utilisable : planifier + voir le coût                                    |
| M6 (P9)  | Version exploitable : résilience, observabilité, déploiement                       |
| M7 (P10) | Front fiable & accessible : navigation sans impasse, clavier, design system        |
| M8 (P11) | Découplage maximal : contrats par contexte, versioning exercé, release par service |
| M9 (P12) | WCAG 2.1 AA : onglets accessibles, focus de route, erreurs actionnables (axe-core) |

## Risques propres aux microservices (et parades)

| Risque                                             | Parade                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Sur-complexité pour un usage perso                 | Périmètre maîtrisé (4 services), automatisation locale (`docker-compose up`), Nx affected. |
| Cohérence distribuée (bugs d'eventual consistency) | Outbox + consommateurs idempotents + tests d'intégration sur la propagation d'événements.  |
| Débogage distribué difficile                       | OpenTelemetry/trace id dès la Phase 1, logs corrélés.                                      |
| Dérive de contrats entre services                  | Tests **Pact** bloquants en CI ; OpenAPI/AsyncAPI versionnés.                              |
| Diversité tarifaire (PSU vs ABCM, futures grilles) | Pattern Stratégie (`PolitiqueTarifaire`) ; grilles versionnées dans le Référentiel.        |

## Démarrer la Phase 9 (prochaine étape)

Phases 0 → 8 faites (cadrage, socle, **domaine tarifaire 100 % couvert**, **service Foyer**,
**service Référentiel**, **service Planification**, **service Tarification**, **API Gateway / BFF**
et **interface web** — `apps/web` React PWA qui ne parle qu'au BFF, calendrier FullCalendar, panneau
coût + vue annuelle + simulation, E2E Playwright). La Phase 9 ouvre le **durcissement & l'exploitation** :
résilience vérifiée (chaos léger), dashboards Grafana + alertes, sauvegardes par base, runbook de
déploiement, export CSV/PDF, a11y & responsive.

➡️ **Guide de reprise détaillé et autosuffisant : [doc 06 → §13 « Phase 8 livrée + point de départ Phase 9 »](06-etat-davancement.md).**
Le front consomme **exclusivement le BFF** (`http://localhost:3000/api/v1`, OpenAPI publié sur
`/api/openapi.json`) : pas d'appel direct aux services. Auth par token (en-tête `Authorization: Bearer`)
quand `GATEWAY_TOKEN` est défini.

> ⚠️ Réutiliser l'enveloppe `IntegrationEvent` et les DTO de `libs/contracts`, les pacts publiés sous
> `pacts/` (les quatre `api-gateway-svc-*.json`), et la façade Gateway déjà branchée vers le Référentiel.

Questions métier encore ouvertes : `Q-05` (recalcul RFR en cours d'année — **traité côté Foyer** via
`actualiserRfr`, à exposer en API plus tard), `Q-08` (dates exactes calendrier Zone B 2026/27 — amorcées
côté Référentiel via `jour_non_facturable`, consommées par la Planification puis projetées côté Tarification).
