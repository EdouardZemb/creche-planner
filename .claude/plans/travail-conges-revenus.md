# Plan d'exécution — SFD 32 « Travail des parents : contrats, absences, congés & revenus »

> **Statut** : brouillon — à valider PO (SFD `docs/32-sfd-travail-conges-revenus.md` en attente de validation). À signaler au PO dès la validation : **US-32-02 CA4** (absence visible dans le planning famille le jour même) ne sera **pas** satisfaite par ce chantier — elle dépend du plan 33 (`planning-famille.md`) ; et la vue « après impôt au taux moyen » du lot 5 (impôt sur le revenu) est **distincte** du crédit d'impôt frais de garde (plan `factures-reelles.md`) — à terme, le crédit calculé pourra alimenter la vue revenus.
> **Dépendances** (état réel au 2026-07-30) :
>
> - **Plan 30 lot 1 — LIVRÉ, déployé prod `0.14.0`** : la « lib de résolution temporelle » est `libs/shared-kernel/src/lib/versionnement.ts` (`PeriodeValidite`, `selectionnerVersionApplicable`, `cloreVersionPrecedente`, `depuisSuite`/`depuisBornes`, `verifierAbsenceChevauchement`/`verifierContinuite` ; erreurs dans `domain-error.ts`). Les lots 4/5 du plan 30 (précédents contrat versionné + UI avenant) sont livrés aussi — ancrages réels en D3 et au lot 2.
> - **Plan 31 lot 1 (`joursFeries(annee, regime)`) — NON LIVRÉ** : requis par H3 et le décompte jours ouvrés du lot 3. Aucune occurrence dans `libs/` à ce jour ; voir H3 (décision de placement en module PARTAGÉ + séquencement, ou fallback).
> - **Fondations backend (assertion HMAC + scoping) — LIVRÉ prod, OBSERVE-ONLY** : la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` est un **prérequis du lot 5** (revenus) — voir récap ops item 4.
> - **Préalables d'orchestration** : train de release n°16 (lot R1 du plan `consolidation-ui-et-qualite.md` — #257 + rejeu de projection, activation A2/A6/A7 en prod) AVANT ce chantier (récap ops item 0) ; lot C0 (atterrir la nav mobile non commitée : `App.tsx`, `App.test.tsx`, `styles.css`, `BarreStatutCalendrier.tsx`) avant tout lot UI (D8).
> - Le plan `planning-famille.md` (SFD 33) consomme directement ce chantier — voir D1/H5. Le plan `factures-reelles.md` réutilisera la check-list « nouveau service » du lot 1 (référence canonique) au lieu de redécouvrir la topologie.
>   **Repères de lignes** : relevés le 2026-07-19 sur main `cc8a708`, **rafraîchis le 2026-07-30 sur main `9aee291`** (plan 30 complet, chantier confiance, lots ops A3/A6/A7 et #257 mergés entre-temps). La copie de travail porte des modifs web non commitées (`App.tsx`, `styles.css`, `BarreStatutCalendrier.tsx`) — s'ancrer sur l'état ACTUEL des fichiers ; si un numéro a dérivé, chercher le symbole.
>   Ce plan est auto-portant.

## 1. Contexte et objectif

Les parents n'existent nulle part en tant que travailleurs : aucun modèle d'employeur, de contrat de travail, d'absence, de solde de congés ni de revenu. Le cas réel à couvrir en priorité, **via des abstractions** (RM-32-01 : jamais de convention en dur) :

- **Parent A** : CDI français Syntec ETAM 3.1, 35 h sans RTT, télétravail quasi complet, 12 mensualités, compteurs CP N−1/N (période 1er juin → 31 mai).
- **Parent B** : contrat suisse (Sulzer, Allschwil), frontalière, 40 % = 16 h/sem, CHF 2 700 brut + 13e salaire en novembre, 25 jours prorata décomptés **en heures** (80 h/an), compteur d'heures sup récupérables.

Faits de code déterminants :

- **Aucun type multi-devises n'existe** : tout est centimes EUR implicites (`libs/shared-kernel/src/lib/money.ts`, `Money` sans devise ; seul `apps/web/src/utils/money.ts` formate en `EUR`). Le multi-devises est à **introduire**, pas à étendre.
- L'infrastructure pour un nouveau service est entièrement mutualisée (`libs/nest-commons` : `DatabaseModule`, `OutboxModule`, `ConsumerModule`, `NatsModule` — le stream est provisionné au boot par `NatsService.provisionnerStream`, aucune déclaration centrale ; `AssertionIdentiteModule` pour l'isolation foyer) et la topologie n'est écrite qu'à un endroit : `scripts/services.json` (`servicesApplicatifs`). Le `Dockerfile` racine est générique (build-arg `APP`, `USER 1000:1000` l.84). La matrix CI `build-images` est automatique (`ci.yml:672`, glob `apps/svc-*,api-gateway,web`) — mais **trois listes en dur** restent hors de `services.json` : le job `smoke-stack` (`.github/workflows/ci.yml:422-425`), la constante `SERVICES` de `scripts/e2e-stack.mjs:38-46` (montée par `docker compose up --wait` dans le job `e2e-stack`) et le tableau `DATABASES` de `scripts/backup-all.sh:33-39` (sauvegardes). Toutes trois à compléter au lot 1.

## 2. Hypothèses assumées (réponses aux questions ouvertes — à corriger par le PO si faux)

- **H1** (Q-32-01) : ancienneté Syntec = simple champ « jours supplémentaires/an » dans le paramétrage du régime (0 par défaut), enrichi plus tard.
- **H2** (Q-32-02) : maintien maladie = paramètres saisissables par régime (carence jours, taux de maintien, durée) avec défauts prudents (FR : carence 3 j, maintien 90 % ; CH : maintien 100 % dès J1) — affinés au premier cas réel. Ces paramètres sont **matérialisés en base dès le lot 3** (colonne `parametres` jsonb sur `type_absence` ou table `regime_absences`, défauts en seed) : sans eux, l'effet revenu `MALADIE` du lot 5 serait incalculable.
- **H3** (Q-32-03) : fériés cantonaux Bâle-Campagne = le contrat de travail référence un calendrier de fériés par **paramètre `regime_feries`** réutilisant le module du plan 31 (`joursFeries(annee, regime)`) étendu d'un régime `CH_BL` (liste cantonale). Les jours fériés de l'employeur ne décomptent pas de congés. ⚠️ **Réalité au 2026-07-30 : ce module N'EXISTE PAS** (plan 31 non exécuté, 0 occurrence dans `libs/`) et le plan 31 le prévoyait dans `libs/planification/domain` (`context:planification`) — import **interdit** depuis `famille-domain` par les depConstraints actuelles (`eslint.config.mjs:24-101`). Décision inter-plans (à porter par le plan 31 lot 1) : hisser `joursFeries` dans un module **partagé** importable des deux contextes (`libs/shared-kernel`, à côté de `versionnement.ts`, ou `libs/shared/calendrier`) avec un type de régime extensible — H3 ajoute `CH_BL` à CE module partagé, jamais un import cross-context. Séquencement : plan 31 lot 1 **avant** le lot 3 de ce plan, OU fallback affaiblissant la dépendance (liste de fériés paramétrée en donnée du régime, portée par `regime_conges`).
- **H4** (Q-32-04) : pas de rappel mensuel « confirmez votre planning » en v1 (le planning base + exceptions suffit ; un rappel serait du bruit).
- **H5 — architecture** : **un seul nouveau service `svc-famille`** porte la SFD 32 (module `travail`) **et** la SFD 33 (module `planning`). Justification : les deux contextes sont centrés foyer/parents, la détection de conflits (33) a besoin des engagements travail **en local** (pas d'appel inter-services dans une boucle d'évaluation), et on ne paie qu'une fois l'infra (base, stream, compose, CI, déploiement). Stream : `FAMILLE` (`famille.>`), source `svc-famille`, port **3007**, base `postgres-famille`. Ports occupés vérifiés (`docker-compose.yml`) : 3000 gateway, 3001 referentiel, 3002 foyer, 3004 planification, 3005 tarification, 3006 notifications — 3007 libre (3003 aussi, trou historique). **Réservation croisée** : port **3003** + stream **`FACTURATION`** sont réservés au plan `factures-reelles.md` (`scripts/services.json` = source unique de topologie) — consignée dans la note topologie du lot 1. Enfin, si un consumer FOYER / read-model membre apparaît (lots 1-2), le concevoir **extensible** : le plan 33 lot 1 l'étend (projection membre partagée entre module travail et module planning) — un durable unique `famille-foyer`, pas un par module.
- **H6** : les taux de change et taux d'impôt sont **saisis** (paramétrables), jamais récupérés d'une source externe en v1 (pré-remplissage marché = backlog SFD).
- **H7** : RM-32-05 : les routes travail/revenus sont scopées foyer (isolation existante) ; pas de cloisonnement entre parents du foyer (modèle de confiance actuel). ⚠️ L'isolation inter-services est encore **observe-only** en prod : le lot 5 (revenus) est conditionné à la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` (récap ops item 4) — pas de routes revenus en observe-only.
- **H8** : aucune nouvelle dépendance npm.

## 3. Décisions structurantes

- **D1 — nouveau service `svc-famille`** (H5) + lib domaine pure `libs/famille/domain` (moteur de congés, compteurs, revenus — zéro I/O) + lib contrats `libs/contracts/famille`.
- **D2 — multi-devises** : nouveau VO `MontantDevise` dans `libs/shared-kernel` (`{ centimes: number; devise: 'EUR' | 'CHF' | string }`, opérations uniquement à devise égale, erreur `DevisesIncompatiblesError`). `Money` existant reste l'EUR implicite du reste de l'app — **ne pas le modifier** (rayon de souffle énorme). ⚠️ **Ne pas copier l'invariant ≥ 0 de `Money`** (`MontantNegatifError`, `money.ts:17-19`) : `MontantDevise` **autorise les montants négatifs** (retenues, écarts de recalage, delta prorata). Stockage : `montant_centimes bigint` + `devise varchar(3)` ; la contre-valeur EUR **constatée** est une colonne à part (RM-32-03 : jamais recalculée a posteriori). Aucune dépendance croisée avec le plan `factures-reelles.md` : lui est EUR-only par hypothèse et reste sur `Money`.
- **D3 — contrat de travail versionné dès le premier jour** avec le socle **livré** du plan 30 : `libs/shared-kernel/src/lib/versionnement.ts` (`depuisSuite` + `selectionnerVersionApplicable` pour « la version applicable au jour », RM-30-01/RM-32-04). Précédents directs à copier : schéma `contrat`/`contratVersion` (`apps/svc-planification/src/database/schema.ts:33/108`, unique `(contrat_id, date_effet)`) et routes `POST/GET /contrats/:id/versions` + `GET …/impact` + `PUT` correction (`apps/svc-planification/src/planification/planification.controller.ts:93-129`). Table `contrat_travail` (identité : parent, employeur, dates de vie) + `contrat_travail_version` (`date_effet`, taux d'activité, h/semaine, semaine type travail jsonb, rémunération jsonb : brut périodique + composantes récurrentes, coefficient net paramétrable, `regime_conges_id`, `regime_absences_id`). Avenant = nouvelle version (CA2 US-32-01 : « 40 % → 60 % »).
- **D4 — régimes = données** : tables `regime_conges` (unité `JOURS_OUVRES|HEURES`, rythme d'acquisition, période de référence `DEBUT_JUIN|ANNEE_CIVILE`, compteurs exposés `N_MOINS_1,N` ou `UNIQUE`, jours d'ancienneté/an) et `type_absence` (libellé, compteur décrémenté `CONGES|HEURES|null`, effet revenu `AUCUN|RETENUE_PRORATA|MALADIE`, justificatif requis). Seeds = **modèles de paramétrage** « FR — légal/Syntec » et « CH — CO/5 semaines » + les 5 types d'absence du tableau SFD §3.2 (RM-32-01).
- **D5 — moteur de congés = fonctions pures** : `soldeTheorique(regime, contratVersions, absences, recalages, date)` — acquisition mois par mois × prises, projeté à toute date (US-32-03 CA1). Le **recalage** (bulletin) devient la base : solde = dernier recalage + delta théorique depuis (RM-32-02 : l'écart est affiché, jamais corrigé en silence).
- **D6 — événements** : `famille.AbsencePosee.v1` / `AbsenceModifiee.v1` / `AbsenceSupprimee.v1` (payload : parentId, foyerId, type, jours/créneaux, effets) et `famille.PlanningTravailModifie.v1` (parentId, foyerId, mois) — consommés en v1 par personne (le module planning 33 lit en local), publiés pour l'extensibilité (notifications futures) et la traçabilité. Enveloppe kernel standard. ⚠️ Les « effets » du payload sont des **types d'effet** (enum), jamais des montants : aucun salaire/solde ne transite dans un événement (confidentialité en profondeur, §4).
- **D7 — grain minimal = créneau** (RM-32-06), **même convention** que les plages horaires existantes (`PlageHoraire`, `libs/planification/domain/src/lib/plage-horaire.ts:10-11` : `debutMinutes`/`finMinutes`, minutes entières) — mais `famille-domain` **n'importe pas** `PlageHoraire` : la lib est taggée `context:planification`, import interdit par les depConstraints (`eslint.config.mjs:24-101`). `famille-domain` définit ses propres types en **miroir local documenté** (précédent du repo : `referentiel-domain`, plan 30 lot 7). Une absence porte des jours entiers **ou** un créneau ; le décompte en heures (régime CH) somme les heures planifiées des créneaux posés.
- **D8 — UI** : nouvelle entrée **« Travail & congés »** dans le panneau « Plus » (`.nav-plus-panneau`, `App.tsx:369` sur la copie de travail — chercher le symbole), routes `/foyers/:foyerId/travail` (+ sous-vues par onglets internes : Contrats, Absences & soldes, Revenus). **Prérequis** : lot C0 du plan `consolidation-ui-et-qualite.md` (faire atterrir la nav mobile non commitée qui touche `App.tsx`/`styles.css`) avant tout lot UI de ce plan — sinon conflits de worktree garantis. Le planning famille (33) aura, lui, un onglet quotidien.

## 4. Conventions transversales

Identiques au plan `versionnement-dates-effet.md` §4. Spécifiques à ce chantier :

- **Nouveau service** : copier la structure de `svc-foyer` (émetteur ; ⚠️ pour le **scoping**, svc-foyer scope en DIRECT avec `scoping: {}` — le modèle « scoping avec résolveur » est `svc-planification`, cf. lot 1) ; `package.json` avec champ `nx` (targets `build` webpack-cli `--config-node-env`, `prune-lockfile`, `copy-workspace-modules`, `prune`, `serve`), `webpack.config.js` (assets migrations → `dist/database/migrations`), `vitest.config.mts` (seuils initiaux réalistes puis ratchet), `drizzle.config.ts`, `tsconfig*`, `eslint.config.mjs`.
- **Frontières Nx** : enregistrer `context:famille` dans les `depConstraints` de la racine (`eslint.config.mjs:24-101`) dès le lot 1 — sans enregistrement explicite, un nouveau contexte n'est **pas** contraint (dérive silencieuse). Liste proposée : `context:famille` → `context:famille`, `context:shared` (+ `context:foyer` si le consumer FOYER/read-model membre se confirme — couplage par contrats d'événements uniquement, même schéma que `context:planification` → `context:foyer`). Jamais `context:planification` (cf. D7, H3 : miroirs locaux/module partagé, pas d'arête).
- **BFF sans import de contrats famille** : `context:gateway` ne peut dépendre que de `gateway`+`shared` — le BFF ne peut **pas** importer `contracts-famille`. Redéclarer les schémas dans `apps/api-gateway/src/bff/bff.dto.ts` (patron assumé du repo : enums inlinés l.139-143, qui évitent exprès l'arête `contracts-foyer`). À écrire dès le lot 2 pour éviter un aller-retour.
- **Surfaces partagées — critère de done de CHAQUE lot exposant une route BFF (lots 2-5)** : `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` (document maintenu **à la main**) mis à jour + oracle « expose exactement les N routes » ajusté (`gateway.openapi.spec.ts:14` — 27 routes aujourd'hui) + `pnpm nx run web:generate-types` sans diff (job CI `openapi-types-drift`, `ci.yml:588-613`) + pactes verts + **couverture baseline CI non dégradée** (gate bloquante si baisse > 0,5 pt de lignes vs main, `ci.yml:180-186`) — un service neuf massif livre ses tests dans le même lot, les seuils vitest locaux ne suffisent pas.
- **Confidentialité en profondeur** : aucun montant (salaire, solde, revenu) dans les logs pino, les traces OTel ni les payloads d'événements (D6) — les données revenus transitent par un pipeline observé de bout en bout (Loki/Tempo/Prometheus). Critère de revue à chaque lot.
- **Mobile 375 px & a11y** : vérif 375 px sur chaque écran livré ; le tableau 12 mois × parents du lot 5 sous conteneur `overflow-x: auto`. Angle mort axe connu du repo : le contraste des marqueurs badge/italique « estimé vs constaté » (CA4 lot 5) échappe à l'audit axe — balayage `getComputedStyle` manuel requis.
- Montants : centimes entiers ; heures : **minutes entières** (même convention que `PlageHoraire`, sans import — D7).
- Pact : nouveau couple `api-gateway ↔ svc-famille` → ajouter `svc-famille` à `providersPact` de `scripts/services.json` (lu par `can-i-deploy.mjs` ; la vérification cosign de toutes les images en découle automatiquement, #259).
- Les chantiers qui touchent `gateway.openapi.ts`/`bff.dto.ts`/`services.json` s'exécutent **séquentiellement** — deux chantiers parallèles sur ces fichiers = conflits garantis.

## 5. Vue d'ensemble des lots

| #   | Lot                                                                       | Dépend de                                                                                  | Modèle                 |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| 1   | Socle `svc-famille` (infra bout-en-bout, service vide)                    | train R1 passé (récap ops item 0)                                                          | Opus 4.8               |
| 2   | Employeurs + contrats de travail versionnés + planning travail (US-32-01) | 1 (socle versionnement plan 30 : LIVRÉ, cf. D3)                                            | Opus 4.8               |
| 3   | Absences typées + régimes + soldes + recalage (US-32-02/03/04)            | 2, plan 31 lot 1 (fériés partagés — ou fallback H3)                                        | Opus 4.8               |
| 4   | Heures supplémentaires (US-32-05)                                         | 3                                                                                          | **délégable Sonnet 5** |
| 5   | Revenus du foyer (US-32-06)                                               | 2 (3 pour l'effet des absences), bascule `INTERSERVICE_AUTHZ_ENFORCE=1` (récap ops item 4) | Opus 4.8               |

Ordre : 1 → 2 → 3 → 4 et 5 (4 et 5 parallélisables, fichiers presque disjoints — merger 4 d'abord, il est petit). Préalables transverses : train R1 avant le lot 1 ; lot C0 consolidation avant les lots UI (D8) ; plan 31 lot 1 avant le lot 3 (ou fallback H3).

---

## Lot 1 — Socle `svc-famille`

**Modèle : Opus 4.8.** Le lot est purement infrastructurel : un service qui boote, migre, répond `/api/health`, est scrappé, sauvegardé, déployé, mais n'a encore aucune route métier. Cette check-list est la **référence canonique « nouveau service »** du repo — le plan `factures-reelles.md` s'y référera. Acquis gratuit : la métrique d'état des migrations + la readiness associée (lot ops A7) viennent de `DatabaseModule`/`HealthModule` de nest-commons, rien à câbler.

### Périmètre exact (check-list du 2026-07-19, complétée le 2026-07-30)

1. `apps/svc-famille/` : `src/main.ts`, `src/app.module.ts` (`ConfigModule`, `LoggerModule.forRoot(buildLoggerParams('svc-famille'))`, `DatabaseModule.forRoot`, `NatsModule.forRoot({ service: 'svc-famille', stream: 'FAMILLE', sujet: 'famille.>', url: () => loadConfig().natsUrl })` — le champ `url` est requis, cf. `svc-foyer/src/app.module.ts:29-34`, `HealthModule`, `OutboxModule.forRoot({ source: FAMILLE_EVENT_SOURCE, table: schema.outbox })` — la const vient de `contracts-famille`, patron `svc-foyer/src/app.module.ts:40`, `AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig, scoping: { resolveur: ResolveurFoyerFamille } })` — pour le scoping avec résolveur, le modèle est **`svc-planification`** (`src/app.module.ts:49-52` + `src/security/resolveur-foyer.ts:23`, `ResolveurFoyerPlanification implements ResolveurFoyerRessource`) ; `svc-foyer`, modèle de structure, scope lui en direct avec `scoping: {}`), `src/config.ts` (+spec : port 3007, `DATABASE_URL`, `NATS_URL`, assertion), `src/tracing.ts`, `src/database/{schema.ts, database.types.ts, migrations/0000_socle.sql}` (tables `outbox`, `processed_event`, `dead_letter` — copies structurelles typecheckées contre les modèles nest-commons), `src/security/resolveur-foyer.ts` (squelette, portées ajoutées aux lots suivants), `package.json` (nx targets, tags `["type:app","context:famille"]`), `webpack.config.js`, `vitest.config.mts`, `drizzle.config.ts`, `tsconfig*`, `eslint.config.mjs`.
2. `libs/contracts/famille/` : lib contrats vide de types d'événements pour l'instant (`FAMILLE_EVENT_SOURCE`), `package.json` avec condition `@creche-planner/source`, tags `["type:contracts","context:famille"]`.
3. **`scripts/services.json`** : `servicesApplicatifs` += `svc-famille` (⚠️ source unique — staging-poll échoue si les compose dérivent).
4. `docker-compose.yml` : `postgres-famille` (postgres:16-alpine, user/db `famille`, healthcheck `pg_isready`), `postgres-exporter-famille`, volume `pg-famille`, service `svc-famille` (build args `APP: svc-famille`, env `PORT/DATABASE_URL/NATS_URL/ASSERTION_IDENTITE_SECRET/OTEL_*`, depends_on, **healthcheck liveness `node` du lot A6** — patron `docker-compose.yml:279-288` : sonde `/api/health/live` sur 3007 via `node -e "fetch(…)"` ; sans lui, `up --wait` (smoke-stack, e2e-stack, deploy.mjs) n'attend pas un service qui SERT).
5. `docker-compose.server.yml` : `svc-famille` (`image: ghcr.io/edouardzemb/creche-planner/svc-famille:${IMAGE_TAG:-main}`, `${PG_FAMILLE_PWD:?}`, `${ASSERTION_IDENTITE_SECRET:?}` + `INTERSERVICE_AUTHZ_ENFORCE: ${INTERSERVICE_AUTHZ_ENFORCE:-}`, `restart: unless-stopped`, **`mem_limit: 384m` + `cpus: 2`** — durcissement lot A6, patron l.186-189 ; ⚠️ pas de clé `user:` dans les compose, le non-root vient du `USER 1000:1000` du `Dockerfile:84`, générique donc gratuit) + `postgres-famille`. `docker-compose.staging.yml` : entrée image alignée.
6. `.env.server.example` : `PG_FAMILLE_PWD` (précédents `PG_*_PWD` l.100-108).
7. `.github/workflows/ci.yml` : compléter la liste en dur de `smoke-stack` (l.422-425) **ET** la constante `SERVICES` de `scripts/e2e-stack.mjs:38-46` (seconde liste en dur, montée par `docker compose up --wait` du job `e2e-stack` — sans elle, les e2e stack des lots 2-5 tourneraient sans le service ou casseraient au premier écran famille) ; la matrix `build-images` est automatique (`ci.yml:672`). Rafraîchir au passage les commentaires de topologie qui servent de carte aux ops : « 4 Postgres » (`ci.yml:414-415` et `scripts/e2e-stack.mjs:33`, déjà faux à 5 → écrire 6) et « 5 services » (`docker/prometheus/alerts.yml:24`, déjà faux à 6 — le job blackbox sonde aujourd'hui api-gateway + 5 svc-_, `docker/prometheus.yml:73-79` → écrire 7, ou reformuler « api-gateway + 6 svc-_ »).
8. **`docker/prometheus.yml`** (⚠️ pas `docker/prometheus/prometheus.yml` — ce dossier ne contient que `alerts.yml`, les règles d'alerte) : cible blackbox `http://svc-famille:3007/api/health/live` (job `blackbox`, l.68-79) + cible `postgres-exporter-famille:9187` avec label `base: famille` (job `postgres`, l.46-57).
9. Gateway (préparation minimale) : `config.ts` += `familleUrl` (`FAMILLE_URL`, défaut `http://localhost:3007` — patron des URLs services `config.ts:161-168`) ; `clients/famille.client.ts` (squelette santé) + `clients.module.ts` ; compose gateway += `FAMILLE_URL`. NB : la readiness gateway ne sonde que le referentiel (`health.controller.ts:22-24`) — aucun impact santé.
10. **Sauvegardes — CRITIQUE** : ajouter `postgres-famille famille famille` au tableau `DATABASES` de `scripts/backup-all.sh:33-39` (liste en dur), vérifier `scripts/restore-one.sh` et la copie hors-site (#261). Précédent exact : base notifications oubliée du même script (#258), sur fond d'incident « 0 backup prod depuis le 17/06 ». Sans cet ajout, les revenus — données les plus sensibles de l'app — ne seraient JAMAIS sauvegardés.
11. **Frontières Nx** : enregistrer `context:famille` dans les `depConstraints` de `eslint.config.mjs:24-101` (liste : cf. §4).
12. **Note topologie** (commentaire dans `scripts/services.json` ou le compose) : port 3007 + stream `FAMILLE` pour ce service ; port **3003** + stream **`FACTURATION`** réservés au plan `factures-reelles.md` — réservation croisée écrite dans les deux plans.

### Critères d'acceptation

- `docker compose up -d --build svc-famille postgres-famille` → boot propre, migration 0000 appliquée, `/api/health` vert (healthcheck compose HEALTHY), stream `FAMILLE` provisionné (logs NATS).
- CI verte : l'image `svc-famille` est construite par la matrix ; smoke-stack passe avec le 8e service applicatif (svc-famille = 8e entrée de la liste `ci.yml:424-425` comme de `servicesApplicatifs`, web et api-gateway inclus — même comptage que le piège « 8e conteneur ») ; `pnpm e2e:stack` monte le service (liste `SERVICES` complétée) ; `staging-poll` en local (dry) ne signale aucune dérive compose↔services.json.
- Sauvegarde : `backup-all.sh` sur la stack locale dumpe la base famille ; `restore-one.sh` la restaure.
- Un `curl` direct sans assertion → log « ASSERTION AURAIT REFUSÉ » (mode observe hérité).
- `corepack pnpm@10.34.2 nx run-many -t typecheck test lint build -p svc-famille contracts-famille api-gateway` vert ; couverture baseline CI non dégradée (le service vide livre déjà ses specs config/santé).

### Pièges connus

- Le champ `nx` vit dans `package.json` (pas de `project.json` séparé) — copier svc-foyer à l'identique, y compris `conditionNames` du webpack.
- **Trois oublis silencieux possibles** (la CI reste verte) : l'entrée `smoke-stack`, la constante `SERVICES` d'`e2e-stack.mjs` et le tableau `DATABASES` de `backup-all.sh` — items 7 et 10 de la check-list, à vérifier explicitement en revue.
- Le secret `ASSERTION_IDENTITE_SECRET` **existe déjà** en prod (chantier fondations) — le réutiliser, ne pas en créer un nouveau.
- Si le train de release qui embarque ce lot part **avant** le train R1 (récap ops item 0), il embarquera #257 : prévoir dans la même fenêtre ops le rejeu de la projection `grille_tarifaire` prod (`UPDATE grille_abcm SET version_payload=1` puis restart svc-referentiel — un simple restart ne suffit PAS).
- Capacité hôte : 8e conteneur applicatif + 6e Postgres + exporter sur un hôte déjà borné (`mem_limit: 384m` × services depuis A6) — estimation RAM/CPU au récap ops item 1.

---

## Lot 2 — Employeurs + contrats de travail versionnés + planning travail (US-32-01)

**Modèle : Opus 4.8.** Dépend du lot 1 ; le socle versionnement du plan 30 est **livré** (ancrages en D3).

### Périmètre exact

- Schéma (migration `0001`) : `employeur` (`id`, `foyer_id`, `nom`, `pays` varchar(2), `devise_paie` varchar(3)), `contrat_travail` (`id`, `foyer_id`, `parent_id`, `employeur_id` FK, `debut`, `fin` NULL), `contrat_travail_version` (`id`, `contrat_id` FK cascade, `date_effet`, `taux_activite` numeric, `heures_hebdo_minutes` integer, `semaine_type` jsonb — par jour : créneaux `{debutMinutes, finMinutes, lieu: 'DOMICILE'|'SITE'|'DEPLACEMENT'}`, `remuneration` jsonb — `{ brutPeriodiqueCentimes, devise, composantes: [{libelle, mois?, montantCentimes, prorataPremiereAnnee?}], coefficientNet }`, `saisi_le`, `motif` NULL ; unique `(contrat_id, date_effet)`), `exception_planning` (`id`, `contrat_id`, `jour`, `creneaux` jsonb NULL — null = jour non travaillé, `lieu` override, `libelle`).
- `libs/famille/domain` : `semaine-travail.ts` (résolution jour → créneaux effectifs : exceptions > semaine type de la version applicable — réutilise la lib versionnement), types, specs. Les deux contrats du cas de référence sont des **fixtures de specs** (CA1 : représentables sans champ fourre-tout).
- svc-famille : module `travail/` — CRUD employeurs, création contrat + version initiale, `POST /contrats-travail/:id/versions` (avenant, clôture implicite via `cloreVersionPrecedente`), `GET …/versions`, CRUD exceptions planning, `GET /contrats-travail?foyer=`. Scoping : `@ScopeFoyerInterServices({ query: 'foyer' })` (`libs/nest-commons/src/lib/security/scope-foyer.decorator.ts:62` — formes `param`/`query`/`body` + `resoudre: '<ressource>'`) et résolveur local `contrat_travail→foyer_id`. Événement `famille.PlanningTravailModifie.v1` sur écritures de planning. Si un read-model membre est introduit ici (sélecteur de parents), concevoir le consumer FOYER **extensible** (durable unique `famille-foyer` — H5, le plan 33 lot 1 l'étendra).
- BFF : `travail.controller.ts` (`/api/v1/foyers/:foyerId/travail/…`, `@FoyerScope('param:foyerId')` — `apps/api-gateway/src/security/foyer-scope.decorator.ts:19`, formes `param:`/`query:`/`contrat:`/`identite`), schémas **redéclarés** dans `apps/api-gateway/src/bff/bff.dto.ts` (le BFF ne peut pas importer `contracts-famille`, cf. §4 — patron enums inlinés l.139-143), client famille étendu. Pact consumer + provider famille (premières interactions ; état `ETAT_CONTRAT_TRAVAIL` — convention `ETAT_*` vérifiée sans collision avec `ETAT_CONTRAT_CRECHE`/`ETAT_CONTRAT_EXISTE`/`ETAT_CONTRAT_VERSIONNE` existants ; `/pacts` est déjà dans `.prettierignore`).
- Web : page `/foyers/:foyerId/travail`, onglet « Contrats » : liste par parent, formulaire employeur + contrat (semaine type par jour avec créneaux et lieu — réutiliser le patron de saisie horaires de `ContratForm` crèche + `editeursSemaine.tsx`), avenant à date d'effet (patron **livré** du plan 30 lot 5 : `apps/web/src/foyer/FormulaireVersionContrat.tsx` + `HistoriqueContrat.tsx` + `ContratsPage.tsx`, #252, prod `0.14.0`). Entrée « Travail & congés » dans `.nav-plus-panneau` (`App.tsx:369`) + titre (`titreDepuisPathname`, `App.tsx:563`) — **après le lot C0** de consolidation (D8).
- **Hors périmètre** : absences/soldes (lot 3), revenus (lot 5), les régimes (posés au lot 3 même si la colonne `regime_conges_id` existe déjà — NULLABLE jusqu'au lot 3).

### Critères d'acceptation

- Les deux contrats réels sont saisissables tels que décrits SFD §1 (test de fixtures + saisie manuelle en stack) ; l'avenant « 40 % → 60 % au 1er octobre » crée une version, l'historique montre les deux, les exceptions (déplacement ponctuel, échange de jour) s'affichent (CA2/CA3).
- Isolation : un foyer B ne lit pas les contrats du foyer A (test intégration scoping, patron des services existants).
- Pactes verts (`can-i-deploy` avec le nouveau provider), e2e légère (unit web) ; `nx run-many -t typecheck test lint -p famille-domain svc-famille contracts-famille api-gateway web` vert.
- **Surfaces partagées (§4)** : `gateway.openapi.ts` mis à jour + oracle N routes ajusté (`gateway.openapi.spec.ts:14`) + `nx run web:generate-types` sans diff (job `openapi-types-drift` vert) + couverture baseline non dégradée.

### Pièges connus

- `parent_id` vient du foyer (svc-foyer) : le service famille ne le vérifie pas par appel inter-services — il fait confiance à l'assertion foyer (patron du repo : résolution locale uniquement). Le BFF fournit la liste des parents du foyer pour le sélecteur (route foyers existante).
- `taux_activite` en `numeric` string Drizzle — parser explicitement (piège `double precision` vs `numeric`).
- Minutes entières partout ; l'affichage « 16 h/sem » est un formatage web.

---

## Lot 3 — Absences typées + régimes + soldes + recalage (US-32-02/03/04)

**Modèle : Opus 4.8.** Dépend du lot 2 **et du plan 31 lot 1 (module fériés partagé — ou fallback H3, à trancher AVANT d'attaquer ce lot)**. Cœur métier du chantier.

### Périmètre exact

- Schéma (migration `0002`) : `regime_conges` et `type_absence` (D4, avec seeds « FR — légal/Syntec », « CH — CO/5 semaines », 5 types d'absence SFD §3.2 — seed idempotent au boot, patron `apps/svc-referentiel/src/referentiel/seed.service.ts`) **+ les paramètres maladie de H2 matérialisés** (colonne `parametres` jsonb sur `type_absence` ou table `regime_absences` : carence jours, taux de maintien, durée par régime, défauts FR/CH en seed — sans eux, l'effet revenu `MALADIE` du lot 5 n'a pas de données à appliquer), `absence` (`id`, `foyer_id`, `parent_id`, `contrat_id`, `type_absence_id` FK, `du`, `au`, `creneau` jsonb NULL, `statut` (`POSEE`|`ANNULEE`), `justificatif_recu` bool NULL, `saisi_le`), `point_recalage` (`id`, `contrat_id`, `date`, `compteurs` jsonb — `[{compteur, acquis, pris, solde}]`, `saisi_le`).
- `libs/famille/domain` : `regime-conges.ts` — moteur pur (D5) : acquisition (2,08 j/mois FR sur juin→mai avec compteurs N−1/N ; prorata heures CH sur année civile), prise (jours ouvrés du planning pour FR ; heures planifiées des jours posés pour CH), `soldeA(date)` et `soldeProjete(dateFuture)` (CA1 US-32-03), recalage (D5), requalification maladie (CA3 US-32-02). Specs nourries des **valeurs réelles du bulletin 04/2026** (N−1 : 11/11/0 ; N : 22,88/11/11,88) comme cas de non-régression.
- svc-famille : routes absences (`POST/PUT/DELETE /absences`, validations : CP → compteur suffisant sinon avertissement non bloquant ; rattrapage → refus si compteur heures insuffisant **sauf confirmation** explicite `forcer: true`, CA2 — le compteur heures arrive au lot 4, la garde est posée derrière une capacité du régime), `GET /soldes?parent=&date=`, `POST /recalages` (CA1 US-32-04 : compteurs + net versé optionnel transmis au module revenus du lot 5). Événements `famille.AbsencePosee.v1` etc. (D6).
- BFF + web : onglet « Absences & soldes » — pose d'absence (type, dates, demi-journée/créneau), soldes par compteur avec **écart théorique/officiel + date du dernier recalage** (CA2 US-32-03), formulaire de recalage « moins d'une minute » (une ligne par compteur, valeurs du bulletin).
- **Hors périmètre** : compteur heures sup (lot 4 — le type « rattrapage » existe mais renvoie « compteur d'heures non configuré » si absent), effet revenu des absences (lot 5), apparition dans le planning famille (SFD 33 — l'événement D6 suffit).

### Critères d'acceptation

- Cas FR : CP 2 semaines en août posé en juin → décompte N−1 d'abord puis N (CA1 US-32-02) ; projection « puis-je poser 2 semaines en août ? » au 1er août = acquisition future incluse − posées (CA1 US-32-03).
- Cas CH : 3 jours posés sur un planning 16 h/sem → décompte en heures planifiées de ces jours (pas 3 × 8 h).
- Recalage bulletin 04/2026 saisi → l'écart s'affiche, le solde repart de la base officielle ; jamais d'écrasement silencieux (RM-32-02).
- Maladie non justifiée requalifiée en justifiée → bascule tracée (CA3).
- `nx run-many -t typecheck test lint -p famille-domain svc-famille api-gateway web` vert ; pactes verts.
- **Surfaces partagées (§4)** : `gateway.openapi.ts` + oracle N routes + `web:generate-types` sans diff + couverture baseline non dégradée.

### Pièges connus

- **Jours ouvrés** = jours du planning de travail du parent, pas lun-ven génériques (un CP sur un jour non travaillé ne décompte rien) ; les fériés du régime ne décomptent pas — via `joursFeries` du **module partagé** issu du plan 31 lot 1 (régimes `FR`/`FR_ALSACE_MOSELLE`/`CH_BL`), qui **n'existe pas encore** (cf. H3) : vérifier sa livraison avant d'attaquer ce lot, sinon appliquer le fallback H3 (liste de fériés en donnée du régime).
- La période de référence FR chevauche deux années civiles — les specs doivent traverser un 31 mai/1er juin.
- Absences à cheval sur un avenant (taux d'activité changé en cours d'absence) : décompte par jour avec la version applicable au jour (RM-30-01) — à tester explicitement.

---

## Lot 4 — Heures supplémentaires (US-32-05)

**Modèle : délégable à Sonnet 5** (mécanique bien bornée). Dépend du lot 3.

### Périmètre exact

- Schéma (migration `0003`) : `saisie_heures` (`id`, `contrat_id`, `jour`, `minutes` integer signé — crédit saisi / débit par rattrapage référencé, `origine` (`SAISIE`|`RATTRAPAGE`|`RECALAGE`), `absence_id` NULL, `commentaire` NULL, `saisi_le`).
- Domaine : `compteur-heures.ts` — solde = somme signée depuis le dernier recalage ; le débit d'un rattrapage = heures planifiées du créneau posé (D7).
- svc-famille : `POST /heures` (crédit), le POST absence « rattrapage » débite dans la même transaction ; `GET /heures?contrat=` (historique crédit/débit/recalage, CA1) ; recalage via `point_recalage` (compteur `HEURES`).
- Web : dans l'onglet « Absences & soldes », bloc « Heures supplémentaires » (Parent B) : saisie rapide (date, durée), solde, historique.
- Activer la garde CA2 du lot 3 (refus si solde insuffisant sauf confirmation → solde négatif signalé).

### Critères d'acceptation

- Crédit 2 h le 12/08 → solde immédiat +2 h ; rattrapage d'un jeudi (4 h planifiées) → −4 h ; historique complet consultable (CA1) ; rattrapage avec solde 1 h → refus, puis accepté avec confirmation et solde −3 h signalé.
- `nx run-many -t typecheck test lint -p famille-domain svc-famille api-gateway web` vert.
- **Surfaces partagées (§4)** pour les routes `/heures` : `gateway.openapi.ts` + oracle N routes + `web:generate-types` sans diff + couverture baseline non dégradée.

### Pièges connus

- Minutes signées entières ; jamais d'heures décimales en base.
- Le compteur n'existe que si le contrat a la capacité (régime CH) — le bloc UI est absent pour le Parent A, pas grisé.

---

## Lot 5 — Revenus du foyer (US-32-06)

**Modèle : Opus 4.8.** Dépend du lot 2 (et du 3 pour l'effet des absences). **Prérequis ops : bascule `INTERSERVICE_AUTHZ_ENFORCE=1` effectuée** (récap ops item 4 — jalon déjà planifié côté fondations/consolidation, atteignable puisque le train R1 précède ce chantier de plusieurs semaines) : les routes revenus n'arrivent pas en observe-only.

### Périmètre exact

- shared-kernel : `MontantDevise` (D2, **négatifs autorisés** — ne pas copier l'invariant ≥ 0 de `Money`) + specs.
- Schéma (migration `0004`) : `revenu_mensuel` (`id`, `foyer_id`, `parent_id`, `contrat_id` NULL, `mois` varchar(7), `montant_centimes` bigint, `devise` varchar(3), `contre_valeur_eur_centimes` bigint NULL — constatée, saisie, jamais recalculée (RM-32-03), `saisi_le` ; unique `(parent_id, mois, contrat_id)`), `parametre_revenu` (`id`, `foyer_id`, `parent_id` NULL, `cle` (`TAUX_CHANGE_REFERENCE`|`TAUX_IMPOT_MOYEN`), `valeur` numeric, `devise` NULL, `date_effet`).
- Domaine : `revenus.ts` — prévisionnel d'un mois = version de contrat applicable au mois (RM-32-04) : brut → net estimé (coefficient calé sur les derniers bulletins), composantes récurrentes (13e salaire en novembre, prorata 1re année), − absences à effet revenu du mois (sans solde/maladie selon régime, §3.2) ; conversion des mois futurs au taux de référence (H6) ; consolidation foyer ; deux vues (avant impôt / après impôt au taux moyen par parent).
- svc-famille : `GET /revenus?foyer=&annee=` (12 mois : réel là où saisi, prévisionnel sinon, chaque montant flaggé `estime: boolean` — CA4), `PUT /revenus/:parentId/:mois` (réel), `PUT /parametres-revenus`. Le recalage du lot 3 qui porte un net versé alimente le réel du mois (CA2 US-32-04).
- BFF + web : onglet « Revenus » — tableau 12 mois × parents + consolidé, bascule « avant impôt / estimation après impôt », montants estimés visuellement distincts (badge/italique + `aria-label`), champ taux de change de référence et taux d'impôt par parent. Rapprochement frais de garde (CA3) : ligne « Frais de garde du mois » alimentée par `api.lireCoutMois` existant (`apps/web/src/couts/PanneauCoutMois.tsx:127`, `dashboard/DashboardJourPage.tsx:274`) → « reste » simple (première brique budget). ⚠️ `lireCoutMois` renvoie le coût **calculé** : quand le plan `factures-reelles.md` livrera, cette ligne devra pouvoir basculer sur le **facturé réel** — isoler la source de la ligne derrière un point d'extension (prop/sélecteur de source), sans implémentation anticipée.
- **Hors périmètre** : PAS/barème frontalier réel, import de bulletins, primes variables (backlog SFD §2) ; le **crédit d'impôt frais de garde** relève du plan `factures-reelles.md` (homonymie fiscale distincte de la vue « après impôt » — cf. statut, à clarifier PO).

### Critères d'acceptation

- Novembre affiche le 13e salaire du Parent B (prorata si 1re année) dans le prévisionnel (CA1) ; une absence sans solde en mois futur réduit ce mois au prorata (CA2) ; réel avril 2026 Parent B : CHF 2 323,95 saisis + contre-valeur EUR constatée — le réel prime toujours sur le calcul (RM-32-03, testé).
- Estimé vs constaté distinguables à l'œil et au lecteur d'écran (CA4) — ⚠️ le contraste des marqueurs badge/italique échappe à axe (angle mort connu) : balayage `getComputedStyle` manuel.
- Vérif 375 px : le tableau 12 mois × parents défile dans son conteneur `overflow-x: auto`, jamais la page (§4).
- **Confidentialité (§4)** : aucun montant (salaire, solde, revenu) dans les logs pino, les traces OTel ni les payloads d'événements — vérifié sur la stack locale (grep des logs après un parcours complet).
- `nx run-many -t typecheck test lint -p shared-kernel famille-domain svc-famille api-gateway web` vert ; pactes verts.
- **Surfaces partagées (§4)** : `gateway.openapi.ts` + oracle N routes + `web:generate-types` sans diff + couverture baseline non dégradée.

### Pièges connus

- **Jamais** de conversion implicite CHF→EUR : sans taux de référence saisi, le prévisionnel CHF affiche « taux à renseigner », pas un montant EUR silencieusement faux.
- Le consolidé foyer n'additionne que des EUR (contre-valeurs) — `MontantDevise` doit lever si on tente de sommer CHF+EUR (c'est le test central du VO).
- Arrondis : centimes entiers à chaque étape (pas de flottants cumulés) ; le coefficient net est un `numeric` appliqué en dernier.

---

## Récapitulatif des actions ops (PO — hors code)

0. **Préalable universel (référencé ici, exécuté par le plan consolidation)** : le train de release n°16 (lot R1 de `consolidation-ui-et-qualite.md`) passe AVANT ce chantier — il active A2/A6/A7 + #264 en prod et déploie #257 avec le **rejeu de la projection `grille_tarifaire`** (`UPDATE grille_abcm SET version_payload=1` puis restart svc-referentiel ; un simple restart ne suffit pas). Il ouvre aussi la fenêtre « 1 semaine de logs propres » qui conditionne la bascule enforce (item 4).
1. **Avant le train du lot 1** : ajouter `PG_FAMILLE_PWD` à `.env.server.enc` via sops (précédents `PG_*_PWD`, `.env.server.example:100-108`). Sans lui, le compose prod refuse (`${VAR:?}`). Estimer au passage la **capacité hôte** : 8e conteneur applicatif + 6e Postgres + exporter sur un hôte borné (`mem_limit: 384m`/`cpus: 2` par service depuis A6) — ajuster les limites si nécessaire.
2. Après le train du lot 1 : vérifier `/api/health` de svc-famille en prod + cibles Prometheus UP (blackbox **et** postgres-exporter-famille) + **le backup nightly suivant inclut la base famille** (dump présent + copie hors-site).
3. Après le lot 3 : saisir les vrais paramétrages (régimes des deux contrats) et comparer les soldes affichés aux bulletins — c'est le smoke test métier. ⚠️ Avoir les **bulletins 04/2026 et les paramétrages réels sous la main le jour du déploiement** du lot 3.
4. **Avant le lot 5** : basculer `INTERSERVICE_AUTHZ_ENFORCE=1` (jalon fondations/consolidation, atteignable car R1 précède ce chantier de plusieurs semaines) — c'est une **condition de mise en route du lot 5**, pas une simple vérif de logs a posteriori.
5. Rappel sécurité données : les revenus sont les données les plus sensibles de l'app — après le lot 5, vérifier qu'aucune route famille n'est accessible sans assertion (enforce actif, item 4) et qu'aucun montant ne fuit dans les logs/traces (confidentialité §4).
