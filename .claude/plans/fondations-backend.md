# Plan d'exécution — Chantier « Fondations backend »

> **Statut** : validé par le PO le 2026-07-17. À exécuter lot par lot (1 lot = 1 PR).
> **Exécutant** : Opus 4.8 (lot 6 délégable à Sonnet 5).
> **Repères de lignes** : relevés le 2026-07-17 sur main `4a4fab9`. Si un numéro de ligne a dérivé, chercher le symbole cité, pas la ligne.

## 1. Contexte et objectif

L'app est un planner de crèche utilisé par des parents sur mobile. Tous les écrans parent ont déjà eu leur chantier qualité. Ce chantier s'attaque à la dette **invisible** : ce qui fait qu'une validation de parent ne peut jamais se perdre en silence, qu'un foyer ne peut jamais lire les données d'un autre, et qu'un incident se voit dans une alerte e-mail avant que le parent ne le subisse.

Quatre faiblesses auditées (audit du 2026-07-17, 4 explorations parallèles du code réel) :

1. **Rejets NATS silencieux** : dans les 3 consumers JetStream (planification, tarification, notifications), un message illisible, une enveloppe non reconnue ou un type inconnu est **ACK sans aucune trace**. Pire : un événement d'un type connu mais au payload invalide (zod échoue) boucle 10 NAK puis JetStream cesse de le livrer — **perdu sans trace**. Scénario redouté : le parent valide sa semaine, la notification ne suit jamais, personne ne le sait.
2. **Confiance aveugle inter-services** : seule l'api-gateway vérifie l'appartenance foyer (`FOYER_AUTHZ_ENFORCE=1` actif en prod). **Aucun header d'identité ne circule** gateway→svc ; les services acceptent n'importe quel `foyerId`. La prod tourne même avec `GATEWAY_AUTH_DISABLED=1` (hypothèse « gateway injoignable depuis le LAN » — hypothèse que ce chantier cesse de tenir pour acquise).
3. **Observabilité à moitié branchée** : Prometheus + Alertmanager + e-mail Gmail sont **déjà déployés et testés en prod** (14 règles actives), mais presque aucune métrique métier n'est émise (backlog outbox, rejets consumers, refus authz, échecs SMTP : rien).
4. **svc-referentiel** : 1 endpoint réellement mort (`GET /frais-fixes/applicable`), 1 endpoint d'écriture **sans auth ni appelant HTTP** (`POST /grilles/abcm`), service le moins testé du dépôt.

## 2. Décisions validées par le PO (ne pas rediscuter)

- **Périmètre** : chantier transversal « fondations backend » en 6 lots (pas de front).
- **Isolation foyer** : **défense en profondeur** — assertion d'identité signée HMAC propagée gateway→svc, revérifiée dans chaque service contre ses **données locales** (jamais de nouvel appel inter-services pour vérifier).
- **Rollout sécurité** : livrer tout câblé en **observe-only** ; l'activation du refus réel (`INTERSERVICE_AUTHZ_ENFORCE=1`) est une action ops documentée, faite plus tard après lecture des logs (même stratégie que `FOYER_AUTHZ_ENFORCE`). **Aucun lot n'active l'enforce en prod.**
- **Consumer JetStream** : **mutualisation** dans `libs/nest-commons` (les 3 copies sont byte-identiques à la liste d'abonnements près), la dead-letter s'insère une seule fois dans la lib.
- **Référentiel — périmètre corrigé** (l'idée initiale « 3 GET morts » était fausse) : on supprime **uniquement** `GET /frais-fixes/applicable` (zéro appelant) et `POST /grilles/abcm` (aucun appelant HTTP, aucune auth). On **garde** `GET /grilles/applicable` (couvert par le Pact api-gateway↔referentiel) et `GET /calendrier/jours-non-facturables` (**appelé par svc-planification** pour exclure fériés/fermetures de la génération des prestations — le supprimer dégraderait la facturation).
- **Métriques** : 4-6 métriques métier + règles d'alerte e-mail via la stack existante (Prometheus/Alertmanager), pas de nouveau canal.

## 3. Hypothèses assumées (défauts pris par le planificateur — à corriger par le PO si faux)

- **H1** : `GATEWAY_AUTH_DISABLED=1` (auth machine web→gateway) reste **hors périmètre** — le chantier sécurise gateway→svc, pas web→gateway.
- **H2** : la table `frais_fixes_abcm` de svc-referentiel (seedée, jamais lue) est **supprimée** (migration DROP TABLE) — le contenu est reproductible par le seed et la vraie source des frais fixes est la classe domaine `libs/tarification/domain/.../frais-fixes-abcm.ts`.
- **H3** : nom du secret partagé : `ASSERTION_IDENTITE_SECRET` ; nom du header : `x-assertion-identite` ; flag d'enforce : `INTERSERVICE_AUTHZ_ENFORCE` (un par service, passthrough compose `${VAR:-}`).
- **H4** : durée de vie de l'assertion : 60 s, tolérance de dérive d'horloge 30 s (mono-machine, largement suffisant).
- **H5** : `POST /api/desabonnement` (svc-foyer) reste **exempté** d'assertion : c'est le point d'entrée RGPD du lien de désabonnement e-mail (`List-Unsubscribe`), auto-authentifié par son propre jeton HMAC, et il doit fonctionner pour un client mail sans session.
- **H6** : les appels **service→service** existants (clients de repli) reçoivent une assertion « machine » signée avec le même secret — sinon l'enforce casserait le récap du mardi et les replis.
- **H7** : seuils d'alerte : backlog outbox > 25 pendant 10 min = warning ; tout rejet consumer = warning ; tout échec SMTP = warning. Ajustables après coup dans `docker/prometheus/alerts.yml` sans redéployer les apps.

## 4. Conventions transversales et pièges du repo (valables pour TOUS les lots)

- **Package manager** : toujours `corepack pnpm@10.34.2 ...` (jamais le pnpm global 8.x). Commandes via nx : `corepack pnpm@10.34.2 nx test <projet>` (le type-check est une arête de la cible).
- **Git** : travailler dans le clone `creche-planner-public`, main est protégée → 1 PR par lot, merge après check `ci` vert. Commits conventionnels en français, sujet ≤ 100 chars (commitlint).
- **Environnement de travail** : `pnpm preflight` en début de session — cf. [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique sur la boucle de dev.
- **Lint** : ESLint 9 flat config type-aware avec ratchet (ne jamais réintroduire de warning) ; `prefer-const`, `noUncheckedIndexedAccess` actifs ; `ReadonlyArray<T>` → `readonly T[]`.
- **Pact** : les pacts sont des fichiers commités dans `pacts/` (pas de broker, ADR-0005). `/pacts` est dans `.prettierignore` (ne pas les reformater). En cas de doublons après régénération : régénérer à blanc. Les specs provider (`apps/svc-*/src/contract/*.provider.pact.spec.ts`) skippent en local sans base et tournent en CI. `can-i-deploy` = `.github/workflows/scripts/can-i-deploy.mjs` (rejette un pact vide).
- **Migrations** : drizzle-kit ^0.31.10, un `drizzle.config.ts` par service, génération `corepack pnpm@10.34.2 drizzle-kit generate` **depuis le dossier du service**, SQL numéroté dans `src/database/migrations/` + `meta/_journal.json`. Appliquées **automatiquement au boot** par `libs/nest-commons/src/lib/database/migration.service.ts` (embarquées dans le bundle webpack `dist/database/migrations`).
- **Ratchet de couverture** : seuils par service dans chaque `vitest.config.mts` (« jamais abaissé »). Après ajout de tests, relever les seuils au nouveau plancher atteint (marge ~2 points) ; ne jamais les baisser.
- **e2e-stack** : l'orchestrateur est **destructif** (`docker compose down -v`) — ne pas le lancer sur une stack de dev qu'on veut garder. Il tourne en CI.
- **Tests unitaires** : Vitest ; nommage `*.spec.ts`, `*.integration.spec.ts`, `*.mbt.spec.ts`.

## 5. Vue d'ensemble des lots

| #   | Lot                                                | Dépend de                              | Modèle                   |
| --- | -------------------------------------------------- | -------------------------------------- | ------------------------ |
| 1   | Dead-letter + mutualisation consumer JetStream     | —                                      | Opus 4.8                 |
| 2   | Métriques métier + alertes e-mail                  | 1 (métrique rejets)                    | Opus 4.8                 |
| 3   | Assertion d'identité signée gateway→svc (observe)  | —                                      | Opus 4.8                 |
| 4   | Scoping local par service + bascule enforce testée | 3                                      | Opus 4.8                 |
| 5   | Ménage svc-referentiel + tests seed/config         | —                                      | Opus 4.8                 |
| 6   | Couverture tests clients fallback + configs        | 3 (les clients sont modifiés au lot 3) | **délégable à Sonnet 5** |

Ordre recommandé : 1 → 2 → 5 → 3 → 4 → 6 (5 peut être fait à tout moment ; 2 juste après 1).

**Actions ops associées (pour le PO, hors code — récapitulées aussi en fin de plan)** :

- Avant le prochain train de release : ajouter `ASSERTION_IDENTITE_SECRET` à `.env.server.enc` (sops, précédent : `DESABONNEMENT_TOKEN_SECRET`, PR #126). Sans lui, `docker compose up` prod refusera (`${VAR:?}`).
- Après le train : `node scripts/apply-observability.mjs` pour charger les nouvelles règles d'alerte.
- Plus tard (après ~1 semaine de logs observe propres) : poser `INTERSERVICE_AUTHZ_ENFORCE=1` (procédure documentée au lot 4).

---

## Lot 1 — Dead-letter + mutualisation du consumer JetStream

**Modèle d'exécution : Opus 4.8.**

### Objectif

Côté parent : plus aucun événement (validation de semaine, modification de foyer…) ne peut disparaître en silence entre deux services. Côté système : les 3 copies byte-identiques de `JetStreamConsumer` deviennent une seule classe dans `libs/nest-commons`, et tout message non traité laisse une trace durable en base + un compteur métrique.

### Périmètre exact

- `libs/nest-commons/src/lib/messaging/` : nouveau `jetstream-consumer.ts` (classe mutualisée), nouveau `dead-letter.ts` (service d'enregistrement + modèle structurel de table, pattern identique à `libs/nest-commons/src/lib/outbox/outbox.options.ts`), specs associées. Export dans `libs/nest-commons/src/index.ts`.
- `apps/svc-planification/src/consumers/jetstream.consumer.ts`, `apps/svc-tarification/src/consumers/jetstream.consumer.ts`, `apps/svc-notifications/src/consumers/jetstream.consumer.ts` : **supprimés**, remplacés par l'usage de la lib (chaque service ne garde que sa configuration d'abonnements + sa table).
- `projection.service.ts` des 3 services : changement du type de retour de `traiter()` (voir décisions).
- `src/database/schema.ts` des 3 services : ajout de la table `dead_letter` (copie conforme, typecheckée contre le modèle de la lib comme pour `outbox`).
- Migrations : svc-planification `0007_dead_letter.sql`, svc-tarification `0003_dead_letter.sql`, svc-notifications `0017_dead_letter.sql`.
- Hors périmètre : l'outbox (lot 2), les règles d'alerte (lot 2), tout changement de logique de projection métier.

### Décisions déjà prises

- **Contrat de traitement** : `ProjectionService.traiter()` ne renvoie plus `boolean` mais un résultat discriminé exporté par la lib :
  `type ResultatTraitement = 'TRAITE' | 'IGNORE_ENVELOPPE_INVALIDE' | 'IGNORE_TYPE_INCONNU' | 'ECHEC_TRANSITOIRE'`.
  Mapping consumer : `TRAITE` → ack ; `IGNORE_*` → **enregistrer en dead-letter puis** ack ; `ECHEC_TRANSITOIRE` → nak (délai 2000 ms actuel conservé).
- **Parse KO** (JSON illisible, aujourd'hui ack muet dans le `catch` de `codec.decode`, ex. planif `jetstream.consumer.ts:159-167`) : géré **dans la lib** → dead-letter raison `PARSE_KO` + ack.
- **Épuisement des livraisons** : avant de NAK un `ECHEC_TRANSITOIRE`, si le nombre de livraisons atteint `MAX_LIVRAISONS` (10, constante existante) → dead-letter raison `MAX_LIVRAISONS` + `message.term()` (et non nak). Utiliser le compteur de livraisons de `JsMsg` (`message.info.redeliveryCount` — vérifier la sémantique exacte du champ dans la version de nats.js du repo et couvrir par un test : la 10ᵉ livraison doit terminer en dead-letter, pas la 2ᵉ).
- **Table `dead_letter`** (une par service, dans sa base dédiée) :
  `id uuid PK default gen_random_uuid()`, `envelope_id uuid NULL` (null si parse KO), `stream varchar(32) NOT NULL`, `sujet varchar(200) NOT NULL`, `raison varchar(32) NOT NULL` (valeurs : `PARSE_KO` | `ENVELOPPE_INVALIDE` | `TYPE_INCONNU` | `MAX_LIVRAISONS`), `payload text NOT NULL` (données brutes, tronquées à 64 Ko max), `erreur text NULL`, `livraisons integer NOT NULL default 1`, `created_at timestamptz NOT NULL default now()`.
- **Métrique** : compteur OTel `consumer_rejets_total` avec attributs `{ stream, raison }`, émis par la lib au moment de l'enregistrement dead-letter. Pattern d'émission : celui de `apps/svc-tarification/src/fallback/planification.client.ts:22-29` (`metrics.getMeter(...)` de `@opentelemetry/api` — le `MeterProvider` est déjà actif via `startTracing()`). Le label `service.name` est ajouté automatiquement par le collector (`resource_to_telemetry_conversion`).
- **Architecture lib** : suivre le pattern `OutboxModule.forRoot(options)` (`libs/nest-commons/src/lib/outbox/outbox.module.ts`) : `ConsumerModule.forRoot({ abonnements, tableDeadLetter })` fournissant le `JetStreamConsumer` + un `DeadLetterService`. La seule chose qui varie par service est la constante `ABONNEMENTS` (planif : `FOYER→planification-foyer` ; tarif : `FOYER`/`REFERENTIEL`/`PLANIFICATION`→`tarification-*` ; notif : `PLANIFICATION`→`notifications-planification`, `FOYER`→`notifications-foyer`) et la table.
- **Conserver à l'identique** : `AckPolicy.Explicit`, `max_deliver: 10`, backoff `[1s, 5s, 15s, 30s]`, `nak(2000)`, `consumers.add` idempotent, binding résilient, shutdown propre. Le pattern d'idempotence `processed_event`/`marquerTraite()` **ne change pas**.

### Conventions à respecter

- Modèle structurel de table + copie par service : imiter exactement `outbox.options.ts:3-18` (typecheck garde-fou).
- Migrations générées par drizzle-kit depuis chaque dossier de service (cf. §4).
- Les injections `DRIZZLE`/`NatsService`/`traceIdCourant` viennent déjà de `nest-commons` — réutiliser.

### Critères d'acceptation

- Un message JSON invalide publié sur un stream consommé → 1 ligne `dead_letter` raison `PARSE_KO`, message ack, compteur incrémenté, **le consumer continue**.
- Une enveloppe sans champ `type` → `ENVELOPPE_INVALIDE` ; un type non géré → `TYPE_INCONNU` ; dans les deux cas ack + trace.
- Un événement de type connu au payload zod invalide → NAK avec backoff, puis à la 10ᵉ livraison : 1 ligne `MAX_LIVRAISONS` + `term()` — **plus de perte silencieuse**.
- Un événement déjà traité (rejeu) → no-op via `processed_event`, **aucune** ligne dead-letter.
- Les 3 fichiers `jetstream.consumer.ts` par service ont disparu ; la classe vit une seule fois dans `libs/nest-commons`.
- Migrations `0007`/`0003`/`0017` présentes et appliquées au boot.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t typecheck test -p nest-commons svc-planification svc-tarification svc-notifications
corepack pnpm@10.34.2 nx run-many -t build -p svc-planification svc-tarification svc-notifications
corepack pnpm@10.34.2 nx run-many -t lint -p nest-commons svc-planification svc-tarification svc-notifications
```

- Reprendre les helpers de mock existants (`fauxMessage`/`fauxIterateur`/`fauxNats` de `apps/svc-planification/src/consumers/jetstream.consumer.spec.ts:16-59`) et les déplacer avec la spec dans la lib ; couvrir chaque raison de rejet + le cas max_deliver.
- Les `projection.service.spec.ts` et `projection.integration.spec.ts` des 3 services passent après adaptation au nouveau type de retour.
- La CI complète (dont provider pacts et e2e-stack) doit être verte sur la PR.

### Pièges connus

- Seul svc-planification a une spec de consumer aujourd'hui — tarif/notif n'en ont pas : la spec de la lib devient la référence unique, ne pas en créer 3 copies.
- `svc-notifications/src/inbox/` n'a **rien à voir** avec les consumers NATS (c'est le journal in-app du parent) — ne pas y toucher.
- Divergences légitimes des projections à préserver : tarif fait un court-circuit `dejaTraite()` hors transaction avant un appel de repli (`projection.service.ts:408`) ; planif ré-émet dans l'outbox dans la même transaction (`projection.service.ts:140-145`).
- Pas d'index sur `published_at`/`created_at` requis (volumes faibles) — ne pas sur-ingénierer.

---

## Lot 2 — Métriques métier + alertes e-mail

**Modèle d'exécution : Opus 4.8** (le placement des métriques demande du jugement ; les règles YAML sont mécaniques mais indissociables).

### Objectif

Côté PO : être prévenu par e-mail (canal Alertmanager existant, déjà testé en prod) qu'un événement a été rejeté, qu'un backlog outbox s'accumule, qu'un e-mail parent échoue ou que la gateway refuse des accès — **avant** que le parent ne s'en aperçoive.

### Périmètre exact

- `libs/nest-commons/src/lib/outbox/outbox.relay.ts` : métriques outbox.
- `apps/api-gateway/src/security/appartenance.guard.ts` : métrique refus authz.
- Mailer (dans `libs/nest-commons/src/lib/mailer/` — vérifier l'emplacement exact du point d'envoi SMTP) : métrique échec d'envoi.
- `docker/prometheus/alerts.yml` : nouveau groupe de règles.
- `docs/exploitation/observabilite.md` : mise à jour.
- Hors périmètre : aucune nouvelle brique d'infra (pas de nouvel exporter, pas de wrapper « meter » dans `libs/observability` — 3 usages directs de l'API OTel existent déjà, on suit ce pattern), pas de dashboard Grafana obligatoire.

### Décisions déjà prises

- **Avant d'ajouter quoi que ce soit** : inventorier les métriques déjà émises (`grep -r "createCounter\|createHistogram\|getMeter" apps/ libs/`) pour ne pas dupliquer. Existants connus : `tarification_repli_planification_total`, un meter dans `apps/svc-notifications/src/scheduler/scheduler.hebdo.ts:72-73`, un dans `apps/svc-notifications/src/fallback/planification.client.ts:19-20`.
- **Métriques à émettre** (nommage snake_case, convention Prometheus du repo) :
  1. `consumer_rejets_total{stream, raison}` — **déjà créée au lot 1**, rien à faire ici côté code.
  2. `outbox_publications_echecs_total` — compteur incrémenté dans le `catch` du drain (`outbox.relay.ts:49-77`).
  3. `outbox_backlog` — **ObservableGauge** dont le callback compte `SELECT count(*) WHERE published_at IS NULL` sur la table du service (le callback est appelé à chaque export, toutes les 15 s ; volume faible, pas d'index nécessaire).
  4. `gateway_authz_refus_total{decision, motif}` — dans `appartenance.guard.ts` : `decision="refuse"` (mode enforce, méthode `refuser` `:119`) ou `"aurait_refuse"` (observe) ; `motif="hors_scope"` ou `"resolution_impossible"` (`surEchecResolution` `:137`).
  5. `notifications_envoi_echecs_total` — au point d'échec SMTP du mailer (si un compteur d'échec existe déjà via le scheduler, compléter plutôt que dupliquer).
- **Règles d'alerte** — nouveau groupe `fondations` dans `docker/prometheus/alerts.yml`, en copiant la structure d'une règle existante (ex. `RepliPlanificationFrequent`, lignes ~150-182, avec `severity` + annotations runbook) :
  - `ConsumerRejetsDetectes` : `increase(consumer_rejets_total[15m]) > 0`, `for: 5m`, severity `warning`.
  - `OutboxBacklogPersistant` : `outbox_backlog > 25`, `for: 10m`, severity `warning`.
  - `OutboxPublicationsEchecs` : `increase(outbox_publications_echecs_total[15m]) > 0`, `for: 5m`, severity `warning`.
  - `EnvoiEmailEchecs` : `increase(notifications_envoi_echecs_total[30m]) > 0`, `for: 0m`, severity `warning`.
  - `AuthzGatewayRefus` : `increase(gateway_authz_refus_total[1h]) > 0`, `for: 0m`, severity `warning`.
    Le routage e-mail est automatique par label `severity` (receiver `email-ops` existant). Seuils = H7, ajustables sans redéployer les apps.
- **Documentation** : dans `docs/exploitation/observabilite.md` — (a) **corriger la ligne ~26** du diagramme qui prétend encore « pas de pipeline métriques configuré » (périmé depuis 2026-06-07, le reste du doc le contredit) ; (b) ajouter les nouvelles métriques et règles au tableau des alertes + une ligne de runbook par alerte (« que faire quand ça sonne » : requête SQL dead_letter, requête Loki, etc.).

### Conventions à respecter

- Émission : API `@opentelemetry/api` directe (`metrics.getMeter('<service>.<domaine>')`), modèle exact `apps/svc-tarification/src/fallback/planification.client.ts:22-29`. Le `MeterProvider` est déjà enregistré par `startTracing()` — ne pas toucher `libs/observability`.
- Chemin des métriques (pour comprendre, pas à modifier) : service → OTLP → otel-collector (`docker/otel-collector-config.yaml`, exporter prometheus :8889) → scrape Prometheus (job `otel-metrics`).

### Critères d'acceptation

- Les 4 nouveaux compteurs/gauges sont émis aux bons endroits, avec tests unitaires (le guard incrémente sur refus ; le relay incrémente sur échec de publication — mock du publish qui throw).
- `docker/prometheus/alerts.yml` contient le groupe `fondations` avec les 5 règles, et la validation de config CI passe (le workflow `config-validation` de la CI valide les fichiers prometheus — vérifier son nom exact dans `.github/workflows/`).
- La doc est à jour (diagramme corrigé + tableau des alertes + runbook).

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p nest-commons api-gateway svc-notifications
```

- Validation locale des règles si promtool est disponible via docker : `docker run --rm -v "$PWD/docker/prometheus:/cfg" prom/prometheus:<tag du compose> promtool check rules /cfg/alerts.yml` (sinon s'appuyer sur le job CI de validation).
- Preuve bout-en-bout (optionnelle en local, sinon décrite pour l'ops) : stack dev (`docker compose up`), provoquer un rejet (publier un JSON invalide sur un stream), puis `curl http://localhost:<port-collector>:8889/metrics | grep consumer_rejets_total`.
- **Action ops post-deploy à inscrire dans la description de la PR** : `node scripts/apply-observability.mjs` (recrée prometheus/alertmanager et vérifie le chargement des règles) ; test de bout en bout possible via `amtool alert add` (procédure `docs/exploitation/observabilite.md:296-334`).

### Pièges connus

- Ne pas créer de « helper meter » dans `libs/observability` — décision explicite de ne pas sur-ingénierer.
- L'ObservableGauge du backlog fait une requête SQL par cycle d'export : garder la requête triviale (`count(*) where published_at is null`), pas de jointure.
- Les conteneurs d'observabilité n'ont pas de healthcheck — c'est `apply-observability.mjs` qui vérifie ; ne pas ajouter de healthchecks au compose.

---

## Lot 3 — Assertion d'identité signée gateway→svc (mode observe)

**Modèle d'exécution : Opus 4.8.**

### Objectif

Côté système : chaque requête qui arrive dans un svc-* porte la preuve signée qu'elle vient de la gateway (ou d'un service interne identifié) et, quand c'est un parent, **qui** il est et **quels foyers** il a le droit de toucher. Ce lot installe toute la tuyauterie en mode observe (log, jamais de refus) ; le lot 4 ajoute le scoping par ressource et la bascule enforce.

### Périmètre exact

- Nouveau dans `libs/nest-commons/src/lib/security/` : `assertion-identite.ts` (signature/vérification), `assertion-identite.guard.ts` (guard aval), décorateur d'exemption, module. Exports dans `libs/nest-commons/src/index.ts`.
- `apps/api-gateway/src/security/` : stockage du contexte résolu (identité + foyers autorisés + admin) et interceptor de propagation.
- `apps/api-gateway/src/clients/` : injection du header dans **tous** les points d'appel sortants (`appel-resilient.ts` + les fetch inline de `planification.client.ts`, `tarification.client.ts`, `notifications.client.ts`, `foyer.client.ts`).
- Clients service→service (assertion machine) : `apps/svc-tarification/src/fallback/{planification,foyer,referentiel}.client.ts`, `apps/svc-notifications/src/fallback/planification.client.ts`, `apps/svc-notifications/src/desabonnement/desabonnement.client.ts`, `apps/svc-planification/src/planification/referentiel.client.ts`.
- Enregistrement du guard (APP_GUARD) + config dans les 5 services : svc-foyer, svc-planification, svc-tarification, svc-notifications, svc-referentiel.
- Les 5 specs provider Pact : `requestFilter`.
- `docker-compose.yml` (dev), `docker-compose.server.yml` (prod) : variables.
- Hors périmètre : tout refus réel (observe only), le scoping par ressource (lot 4), l'auth web→gateway (`GATEWAY_TOKEN`/`GATEWAY_AUTH_DISABLED`, hypothèse H1).

### Décisions déjà prises

- **Format de l'assertion** : mini-JWS maison HMAC-SHA256, **copié du modèle existant** `apps/svc-foyer/src/foyer/desabonnement.jeton.ts` (`signerJeton`/`verifierJeton` : `base64url(payload JSON)` + `.` + `base64url(signature)`, comparaison `timingSafeEqual`, expiration `exp`). Pas de dépendance nouvelle (node:crypto).
- **Payload** : `{ v: 1, email?: string, foyers?: readonly string[], admin?: boolean, machine?: string, iat: number, exp: number }`. Exactement un de `email` | `machine` est présent. `exp = iat + 60`, tolérance de dérive ±30 s à la vérification (H4). `machine` = nom du service émetteur (`'api-gateway'`, `'svc-tarification'`, …).
- **Header** : `x-assertion-identite`. **Secret** : `ASSERTION_IDENTITE_SECRET` (H3), partagé par la gateway et les 5 services.
- **Côté gateway — comment le contexte arrive aux clients** (les clients sont des singletons, ils ne connaissent pas la requête) :
  - `AsyncLocalStorage` de `node:async_hooks` (pas de dépendance nouvelle, pas de request-scope Nest).
  - Un `APP_INTERCEPTOR` (enregistré **après** les guards, donc exécuté après eux) lit `req.identite` (posé par `IdentiteGuard`, `identite.guard.ts:38`) et le contexte d'appartenance, et exécute le handler dans le scope ALS.
  - `AppartenanceGuard` (`appartenance.guard.ts:44`) **stocke sur `req`** la liste des foyers autorisés qu'il résout déjà via `FoyerClient.foyersParEmail` (`:94`) et le statut admin, pour que l'interceptor les reprenne. Sur les routes sans `@FoyerScope`, `foyers` est absent de l'assertion (le lot 4 définit route par route ce que ça implique).
  - Helper unique `entetesAval(): Record<string,string>` dans `apps/api-gateway/src/clients/` : si un contexte parent est présent dans l'ALS → assertion parent `{ email, foyers?, admin? }` ; sinon (appels hors requête, et **appels de résolution faits par les guards eux-mêmes** — `FoyerClient.foyersParEmail`, `PlanificationClient.contrat()` — qui s'exécutent avant l'interceptor) → assertion **machine** `{ machine: 'api-gateway' }`. Signature à chaque appel (pas de cache, coût négligeable).
  - Recenser **tous** les points d'appel sortants par `grep -n "fetchAvecTimeout\|fetch(" apps/api-gateway/src/clients/` et injecter `...entetesAval()` dans chaque `init.headers`. Piège connu : seul `FoyerClient` passe par le wrapper `appel-resilient.ts:90` ; `PlanificationClient` et les autres réimplémentent fetch inline (ex. `planification.client.ts:157`) — **ne pas** refondre ces clients vers le wrapper dans ce lot (churn inutile), juste injecter le helper.
- **Clients service→service** : chaque client de repli listé au périmètre signe une assertion machine `{ machine: '<nom-du-service>' }` avec le même secret et l'ajoute à ses headers. **Critique** : sans ça, l'enforce futur casserait le récap du mardi (svc-notifications→svc-planification) et les replis tarification.
- **Guard aval `AssertionIdentiteGuard`** (lib, enregistré APP_GUARD dans les 5 services) — 3 modes :
  - Secret absent (`ASSERTION_IDENTITE_SECRET` non défini) : mode **legacy** — passe, log debug unique au boot (« assertion inter-services non configurée »). C'est le mode des environnements non migrés.
  - Secret présent, `INTERSERVICE_AUTHZ_ENFORCE` absent/≠1 : mode **observe** — vérifie ; si header absent/invalide/expiré, log `warn` structuré « ASSERTION AURAIT REFUSÉ » avec méthode+chemin+motif, **et passe**. Si valide, pose `req.assertion` (payload vérifié) pour le lot 4.
  - `INTERSERVICE_AUTHZ_ENFORCE=1` : mode **enforce** — 401 si header absent/invalide/expiré. (La logique existe et est testée dès ce lot, mais **aucun environnement ne l'active** dans ce chantier.)
  - **Exemptions** (décorateur `@AssertionPubliqueInterServices()` ou allowlist de chemins dans le guard — choisir le décorateur, plus lisible) : les routes du `HealthModule` (`/api/health*` — sondées par les healthchecks docker et blackbox-exporter **sans header**, les exempter est obligatoire sous peine de faire tomber tout le monitoring en enforce) et `POST /api/desabonnement` de svc-foyer (H5, auto-authentifié par son jeton HMAC RGPD). `POST /api/desabonnement/jetons` (interne) n'est **pas** exempté (appelé par svc-notifications avec assertion machine).
- **Config par service** : lecture de `ASSERTION_IDENTITE_SECRET` et `INTERSERVICE_AUTHZ_ENFORCE` dans le `config.ts` de chaque service (pattern existant `loadConfig()`). **Pas** de `verifierConfigProduction()` exigeant le secret dans ce lot (le compose `:?` fait office de garde prod ; on évite de casser un boot local).
- **Pact — `requestFilter`** : dans chacune des 5 specs provider (`apps/svc-*/src/contract/*.provider.pact.spec.ts`), (a) poser `process.env.ASSERTION_IDENTITE_SECRET = 'pact-assertion-secret'` avant le boot du service (précédent : le secret désabo est déjà épinglé à `pact-desabo-secret` dans `foyer.provider.pact.spec.ts:~143`), (b) ajouter un `requestFilter` qui injecte `x-assertion-identite` signé avec ce secret, payload `{ machine: 'api-gateway' }` (simple et suffisant : en observe rien ne refuse ; au lot 4 l'enforce des specs passera car l'assertion machine bypasse le scoping). Les fichiers `pacts/*.json` **ne changent pas** (les headers n'y sont pas déclarés) → pas de dérive pact, `can-i-deploy` inchangé.
- **Compose** :
  - `docker-compose.yml` (dev/CI) : `ASSERTION_IDENTITE_SECRET: dev-assertion-secret` sur api-gateway + les 5 svc — le chemin signature/vérification est ainsi **réellement exercé** en dev et en e2e-stack (en observe).
  - `docker-compose.server.yml` (prod) : `ASSERTION_IDENTITE_SECRET: ${ASSERTION_IDENTITE_SECRET:?definir dans .env.server}` sur les 6 conteneurs, + passthrough `INTERSERVICE_AUTHZ_ENFORCE: ${INTERSERVICE_AUTHZ_ENFORCE:-}` (pattern existant `FOYER_AUTHZ_ENFORCE`, lignes ~237-247).

### Conventions à respecter

- Crypto : copier la structure de `desabonnement.jeton.ts` (b64url, `timingSafeEqual`) — ne pas introduire `jose` côté services (il n'est utilisé que par la gateway pour CF Access).
- Logs : format aligné sur l'existant de la gateway (« AURAIT REFUSÉ », `appartenance.guard.ts:119-120`) pour pouvoir grepper les deux familles dans Loki d'une seule requête.
- Branded types / unions exhaustives pour `ResultatVerification` du guard (conventions strictes du repo).

### Critères d'acceptation

- En stack dev : tous les parcours existants fonctionnent à l'identique (observe = zéro refus) ; les logs des svc montrent des assertions vérifiées (et aucun « AURAIT REFUSÉ » sur les parcours nominaux — sinon c'est qu'un point d'appel a été oublié).
- Un appel direct à un svc **sans** header (curl) produit un log « ASSERTION AURAIT REFUSÉ » (et passe — observe).
- Tests unitaires lib : signature/vérification (nominal, expiré, dérive d'horloge tolérée, signature falsifiée, payload mixte email+machine rejeté), guard (3 modes × header absent/invalide/valide, exemptions).
- Les 5 specs provider Pact passent avec le `requestFilter` ; les fichiers `pacts/*.json` sont inchangés (`git diff --stat pacts/` vide).
- e2e-stack CI verte (le secret dev est posé dans le compose).

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p nest-commons api-gateway svc-foyer svc-planification svc-tarification svc-notifications svc-referentiel
corepack pnpm@10.34.2 nx run-many -t build -p api-gateway svc-foyer svc-planification svc-tarification svc-notifications svc-referentiel
```

- Vérif ciblée de non-oubli : `grep -rn "fetchAvecTimeout\|fetch(" apps/api-gateway/src/clients/ apps/svc-*/src/fallback/ apps/svc-planification/src/planification/referentiel.client.ts apps/svc-notifications/src/desabonnement/` — chaque site doit passer par le helper d'entêtes.
- Stack locale : `docker compose up -d` (l'override dev publie les ports svc 3001-3006), puis `curl http://localhost:3005/api/couts?foyer=<uuid>&mois=2026-07` sans header → 200 + log « AURAIT REFUSÉ » dans `docker compose logs svc-tarification`.

### Pièges connus

- **Ordre guards/interceptor** : les appels de résolution `foyersParEmail`/`contrat()` partent **depuis les guards**, avant tout interceptor — c'est pour ça que `entetesAval()` doit retomber sur l'assertion machine hors scope ALS. Ne pas essayer de mettre l'ALS dans un middleware (il court avant les guards et n'aurait pas l'identité).
- **Healthchecks** : blackbox-exporter et les healthchecks docker sondent `/api/health*` sans header — l'exemption est non négociable.
- Les specs provider Pact skippent en local sans base — la preuve est le job CI.
- `verbatimModuleSyntax` est web-only ; ne pas l'appliquer aux libs Nest.
- Ne pas régénérer les pacts consumer : aucun header n'est déclaré côté pact, toute régénération « pour rien » crée du bruit de diff.

---

## Lot 4 — Scoping par ressource dans chaque service + bascule enforce testée

**Modèle d'exécution : Opus 4.8.**

### Objectif

Côté parent : même si la gateway est contournée ou boguée, un foyer ne peut jamais lire ni écrire les données d'un autre. Chaque service refuse (en enforce) toute requête dont l'assertion ne couvre pas le foyer de la **ressource réellement visée**, résolu contre ses propres tables.

### Périmètre exact

- `libs/nest-commons/src/lib/security/` : extension du guard (ou second guard dédié) pour le scoping, décorateur `@ScopeFoyerInterServices(...)`, port `ResolveurFoyerRessource` que chaque service implémente.
- Controllers + un petit resolver par service : svc-foyer, svc-planification, svc-tarification, svc-notifications.
- Les 5 specs provider Pact : passage en `INTERSERVICE_AUTHZ_ENFORCE=1`.
- `docs/exploitation/` : procédure d'activation.
- Hors périmètre : activer l'enforce dans un compose (dev reste observe ; prod = action ops ultérieure), tout changement des règles métier des handlers.

### Décisions déjà prises — règles de scoping route par route (inventaire exhaustif, tranché)

Règles générales :

- Assertion **machine** valide → bypass du scoping (appelant interne de confiance). Assertion parent avec `admin: true` → bypass (aligné sur le bypass admin de la gateway).
- Résolution ressource→foyer **toujours locale** (tables du service). Ressource inexistante → laisser le handler répondre son 404 habituel (pas de 403 qui révélerait l'existence).
- En observe : toute violation logge « SCOPE AURAIT REFUSÉ » + incrémente `gateway_authz_refus_total` ? **Non** — nouvelle métrique dédiée `svc_scope_refus_total{decision}` émise par le guard de la lib (même modèle que le lot 2 ; ajouter la règle d'alerte `ScopeInterServicesRefus` warning dans `alerts.yml` au passage).
- En enforce : violation → **403**, header absent/invalide → **401**.

**svc-foyer** (`apps/svc-foyer/src/foyer/foyer.controller.ts`) :

- `POST /api/foyers` (`:50`) : `body.createurEmail === assertion.email` (sinon violation).
- `GET /api/foyers?parentEmail=` (`:62`) : `query.parentEmail === assertion.email`.
- Toutes les routes `/api/foyers/:id/**` (`:72` à `:162` — foyer, enfants, parents, préférences) : `:id ∈ assertion.foyers`.
- `POST /api/desabonnement/jetons` (`desabonnement.controller.ts:28`) : signature seule (machine attendu), pas de scoping foyer.
- `POST /api/desabonnement` (`:36`) : **exempté** (lot 3, H5).

**svc-planification** (`planification.controller.ts`, `etablissement.controller.ts`) :

- `GET /api/contrats?foyer=` (`:52`), `POST /api/contrats` (foyerId body, `:69`), `GET/POST /api/etablissements?foyer=` (`etablissement.controller.ts:31,:39`) : foyerId ∈ `assertion.foyers`.
- `GET/PUT/DELETE /api/contrats/:id` et sous-routes plannings/etablissement/enfant (`:63,:78,:93,:109,:119,:131,:148,:170`) : résoudre `contrat.foyerId` (table `contrat` locale) puis inclusion.
- `GET /api/prestations?contrat=` (`:186`) : résoudre le contrat, puis inclusion.
- `GET/PUT/DELETE /api/etablissements/:id` (`etablissement.controller.ts:50,:56,:66`) : résoudre `etablissement.foyerId` (table locale) puis inclusion.

**svc-tarification** (`cout.controller.ts`) :

- `GET /api/couts?foyer=` (`:24`), `GET /api/couts/annuel?foyer=` (`:38`) : inclusion.

**svc-notifications** (`validation.controller.ts`, `envoi.controller.ts`, `inbox.controller.ts`) :

- `GET /api/validations/a-valider?foyer=` (`validation.controller.ts:29`) : inclusion.
- `POST /api/validations/:contratId/:semaineIso` (`:37`) : résoudre `contrat.foyerId` via la table projetée `contrat` (`src/database/schema.ts:46-49` — elle existe, `foyer_id NOT NULL`), puis inclusion.
- `GET .../brouillon` (foyerId param, `envoi.controller.ts:45`) et `POST /api/envois/etablissement` (foyerId body, `:57`) : inclusion. (Route sensible : elle envoie un vrai mail au service de garde.)
- `GET /api/moi/notifications?parent=` (`inbox.controller.ts:29`) et `POST /api/moi/notifications/:id/lu?parent=` (`:38`) : résoudre `foyer_parent` par `parentId` (table `foyer_parent`, `schema.ts:123-129`, porte `email` et `foyer_id`) et exiger `foyerParent.email === assertion.email` (comparaison insensible à la casse, cohérente avec l'unicité `lower(email)` du repo).

**svc-referentiel** : aucune donnée foyer — signature seule (lot 3), pas de scoping.

### Autres décisions

- Implémentation : décorateur posé sur chaque route avec la source du foyer (`{ param: 'id' }`, `{ query: 'foyer' }`, `{ body: 'foyerId' }`, `{ resoudre: 'contrat', param: 'id' }`…), inspiré de `@FoyerScope`/`extraireRefFoyer` de la gateway (`apps/api-gateway/src/security/foyer-scope.ts:63`) — même vocabulaire pour que le code se lise pareil des deux côtés. Chaque service fournit son `ResolveurFoyerRessource` (drizzle, requêtes `select foyer_id from ... where id = ...`).
- Les specs provider Pact passent à `INTERSERVICE_AUTHZ_ENFORCE=1` (l'assertion machine du `requestFilter` du lot 3 bypasse le scoping) — la CI prouve ainsi que le guard enforce n'explose pas sur les 5 services.
- Tests d'intégration par service (avec `INTERSERVICE_AUTHZ_ENFORCE=1` posé dans la spec) couvrant : assertion du bon foyer → 200 ; foyer étranger → 403 ; sans header → 401 ; assertion machine → 200 ; assertion expirée → 401 ; ressource inexistante → 404 (pas 403).
- **Procédure d'activation prod** (à écrire dans `docs/exploitation/`, section dédiée ou fichier `authz-inter-services.md`) : 1) vérifier ~1 semaine de logs observe sans « AURAIT REFUSÉ » légitime (requête Loki fournie) ; 2) poser `INTERSERVICE_AUTHZ_ENFORCE=1` dans `.env.server` (sops) ; 3) recréer les conteneurs ; 4) vérifier `/api/health` + un parcours parent ; 5) rollback = retirer la variable. L'activation elle-même est **hors chantier** (décision PO).

### Critères d'acceptation

- Chaque route de l'inventaire ci-dessus porte sa règle (aucune route listée sans décorateur — l'exhaustivité est vérifiée par une revue systématique des controllers cités).
- Tous les tests d'intégration cross-foyer passent ; e2e-stack CI verte (observe en stack) ; les 5 provider pacts verts **en enforce**.
- La procédure d'activation est documentée.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p nest-commons svc-foyer svc-planification svc-tarification svc-notifications
corepack pnpm@10.34.2 nx run-many -t build -p svc-foyer svc-planification svc-tarification svc-notifications
```

- Preuve manuelle en stack dev : exporter `INTERSERVICE_AUTHZ_ENFORCE=1` sur un seul service (override compose local), rejouer un parcours parent complet via le front (Vite dev :4200, cf. mémoire « Vérif UI locale ») → tout fonctionne ; puis curl direct avec un foyer étranger → 403.

### Pièges connus

- **Ne pas dupliquer la logique de la gateway** : le service ne résout jamais « quels foyers a ce parent » (c'est le rôle de la gateway, transporté par l'assertion) ; il résout seulement « à quel foyer appartient cette ressource » dans ses propres tables.
- La comparaison d'e-mails doit être insensible à la casse (`lower(email)` est la convention d'unicité du repo).
- `POST /api/envois/etablissement` envoie un **vrai mail** — dans les tests, rester en dry-run (pattern existant des specs notifications) ; ne jamais pointer `jaudrey@cscpapin.asso.fr`.
- Le libellé des logs doit rester greppable conjointement avec ceux de la gateway (« AURAIT REFUSÉ »).

---

## Lot 5 — Ménage svc-referentiel + tests seed/config

**Modèle d'exécution : Opus 4.8** (une migration destructive et un déplacement de validation — trop d'arbitrage résiduel pour Sonnet).

### Objectif

Côté système : svc-referentiel ne garde que ce qui sert (publication de grilles par événement, calendrier pour la planification, grille applicable sous contrat Pact), perd sa surface d'écriture HTTP non protégée, et ses deux fichiers jamais testés (seed, config) gagnent des specs.

### Périmètre exact

- `apps/svc-referentiel/src/referentiel/referentiel.controller.ts`, `referentiel.service.ts`, `referentiel.dto.ts`, `seed.service.ts` + leurs specs.
- `apps/svc-referentiel/src/database/schema.ts` + nouvelle migration `0001_*`.
- Nouveaux : `seed.service.spec.ts`, `config.spec.ts`.
- Hors périmètre : `GET /grilles/applicable` et `GET /calendrier/jours-non-facturables` (**vivants — ne pas toucher**), le pact `pacts/api-gateway-svc-referentiel.json` (inchangé), les tables `grille_abcm`, `bareme_psu`, `jour_non_facturable`.

### Décisions déjà prises

- **Supprimer `GET /frais-fixes/applicable`** (`referentiel.controller.ts:63-66`) + `fraisFixesApplicable()` (`referentiel.service.ts:252-267`) + l'interface `FraisFixesVue` (`:82-87`) + le bloc de tests correspondant (`referentiel.service.spec.ts:321-343` et le cas controller).
- **Supprimer la partie frais fixes du seed** (`amorcerFraisFixes` dans `seed.service.ts`) et **la table `frais_fixes_abcm`** (retrait de `schema.ts` + migration `0001` avec `DROP TABLE`) — H2 : donnée seed-reproductible, la source de vérité des frais fixes est la classe domaine `libs/tarification/domain/.../frais-fixes-abcm.ts`. C'est la **première migration destructive du service** : le SQL doit être un simple `DROP TABLE IF EXISTS frais_fixes_abcm;`.
- **Supprimer `POST /grilles/abcm`** du controller (`referentiel.controller.ts:36-44`). La méthode `referentiel.publierGrilleAbcm()` **reste** (appelée en process par `seed.service.ts:128-137`). **Déplacer la validation zod** : `publierGrilleAbcmSchema` (`referentiel.dto.ts`) n'est plus branché sur un pipe HTTP → le `parse()` se fait désormais **en tête de `publierGrilleAbcm()`** dans le service, si bien que les données du seed sont validées aussi. Garder le schéma et sa spec (`referentiel.dto.spec.ts`), supprimer le `ZodValidationPipe` s'il ne sert plus à rien d'autre dans ce service.
- `exigerDate` (`referentiel.controller.ts:74-81`) **reste** (utilisé par les 2 GET conservés).
- **Nouvelles specs** :
  - `seed.service.spec.ts` : idempotence (table non vide → skip complet), insertion des 3 grilles `GRILLES_2026` + barèmes PSU + jours non facturables au premier boot, retry sur base indisponible (le retry 5 s existant), et validation zod appliquée aux grilles seedées.
  - `config.spec.ts` : lecture des variables d'env + valeurs par défaut + coercition `Number(port)` (modèle : `apps/svc-foyer/src/config.spec.ts`).
- Relever le ratchet de couverture de `apps/svc-referentiel/vitest.config.mts:36-41` (actuels : statements 52 / branches 62 / functions 52 / lines 53) au nouveau plancher atteint, marge ~2 points.

### Conventions à respecter

- Migration générée par drizzle-kit depuis `apps/svc-referentiel/` (elle sera `0001_...`), appliquée au boot.
- Le client de repli `apps/svc-tarification/src/fallback/referentiel.client.ts` appelle `grilles/applicable` — conservé, ne pas y toucher ici (il gagne une spec au lot 6).

### Critères d'acceptation

- `GET /frais-fixes/applicable` et `POST /grilles/abcm` répondent 404 ; les 2 GET conservés répondent comme avant.
- Le seed au premier boot insère grilles + PSU + jours (plus de frais fixes) ; un boot sur base déjà seedée ne réinsère rien.
- La spec provider Pact de referentiel passe (l'unique interaction `GET /grilles/applicable` est intacte) ; `pacts/` sans diff ; `can-i-deploy` inchangé.
- Migration `0001` présente ; boot sur une base existante (avec la table) la droppe proprement.
- Ratchet de couverture relevé, jamais abaissé.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t typecheck test lint build -p svc-referentiel
git diff --stat pacts/        # doit être vide
```

- Stack dev : `docker compose up -d svc-referentiel` (+ sa base), vérifier les logs de seed et `curl http://localhost:<port>/api/grilles/applicable?date=2026-09-15&mode=CANTINE&tranche=3` → 200.

### Pièges connus

- **Ne surtout pas** supprimer `GET /grilles/applicable` (pact — la CI casserait : l'unique interaction du pact referentiel deviendrait introuvable et un pact vide fait échouer `can-i-deploy`) ni `GET /calendrier/jours-non-facturables` (appelé par `apps/svc-planification/src/planification/planification.service.ts:820` — sa disparition dégraderait **silencieusement** la génération des prestations).
- La spec provider (`referentiel.provider.pact.spec.ts`) démarre le bundle réel : si le lot 3 est déjà mergé, elle contient le `requestFilter` — ne pas le casser.
- Si ce lot passe avant le lot 3, il n'y a aucun conflit ; s'il passe après, rebaser proprement (les fichiers controller/config sont touchés par les deux).

---

## Lot 6 — Couverture de tests : clients fallback + configs

**Modèle d'exécution : délégable à Sonnet 5** (pattern entièrement décrit, specs modèles à imiter, zéro arbitrage produit). À lancer **après le lot 3** (les clients gagnent l'entête d'assertion au lot 3 ; écrire les specs après évite le churn).

### Objectif

Côté système : les chemins de repli (ceux qui sauvent l'expérience parent quand un service est indisponible) et les configs de boot cessent d'être les seuls morceaux non testés du backend.

### Périmètre exact — un fichier de spec par client/config listé, rien d'autre

Specs modèles à imiter (structure, mocks, nommage) :

- Client avec résilience : `apps/svc-tarification/src/fallback/planification.client.spec.ts` et `apps/svc-planification/src/planification/referentiel.client.spec.ts`.
- Client gateway : `apps/api-gateway/src/clients/foyer.client.spec.ts`.
- Config : `apps/svc-foyer/src/config.spec.ts` (et `apps/api-gateway/src/config.spec.ts`).

À créer :

1. `apps/svc-tarification/src/fallback/referentiel.client.spec.ts` — succès (parse zod), 4xx/5xx → `undefined` (dégradation), timeout, circuit ouvert.
2. `apps/svc-tarification/src/fallback/foyer.client.spec.ts` — succès, erreur → repli, résilience.
3. `apps/svc-notifications/src/fallback/planification.client.spec.ts` — mapping réponse, dégradation si indisponible.
4. `apps/svc-notifications/src/desabonnement/desabonnement.client.spec.ts` — chemin nominal + erreur réseau.
5. `apps/api-gateway/src/clients/planification.client.spec.ts` — les méthodes principales (contrat, plannings) : succès, erreur HTTP, timeout via `executerResilient`.
6. `apps/api-gateway/src/clients/tarification.client.spec.ts` — idem.
7. `apps/api-gateway/src/clients/notifications.client.spec.ts` — idem.
8. `apps/svc-planification/src/config.spec.ts` et `apps/svc-tarification/src/config.spec.ts` — lecture env + défauts + coercition (modèle svc-foyer). (`svc-referentiel/config.spec.ts` est fait au lot 5.)

Hors périmètre : modifier le code de production (si un test révèle un bug réel, le **signaler dans la PR** sans le corriger — il sera traité séparément) ; les seuils d'autres services.

### Décisions déjà prises

- Mock du réseau : `vi.stubGlobal('fetch', ...)` / mocks du même style que les specs modèles — pas de nock/msw (pas de nouvelle dépendance).
- Chaque spec vérifie aussi que l'entête `x-assertion-identite` est présent sur les appels sortants (introduit au lot 3) — une assertion par spec suffit.
- Relever le ratchet de couverture (`vitest.config.mts` de svc-tarification, svc-notifications, svc-planification, api-gateway) au nouveau plancher, marge ~2 points. Ne jamais baisser.

### Critères d'acceptation

- Les 9+ fichiers de spec existent et passent ; aucun fichier de production modifié.
- Couverture : plus aucun client HTTP du backend à 0 % de fonctions couvertes (`FNDA:0`).
- Ratchets relevés.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p api-gateway svc-planification svc-tarification svc-notifications
```

### Pièges connus

- `prefer-const` et `noUncheckedIndexedAccess` mordent dans les specs aussi.
- Les tests de timeout : utiliser les fake timers Vitest comme dans les specs modèles, ne pas dormir réellement.

---

## Récapitulatif des actions ops (PO — hors code, aucune n'est faite par l'exécutant)

1. **Avant le prochain train de release** (dès que le lot 3 est mergé) : ajouter `ASSERTION_IDENTITE_SECRET` (valeur aléatoire ≥ 32 octets) à `.env.server.enc` via sops (précédent exact : `DESABONNEMENT_TOKEN_SECRET`, PR #126, sops non-interactif). Sans lui, le compose prod refusera de démarrer (`${VAR:?}`).
2. **Après le train** (lot 2 mergé) : `node scripts/apply-observability.mjs` pour charger le groupe d'alertes `fondations` ; test optionnel via `amtool alert add`.
3. **Plus tard** (~1 semaine de logs observe propres, requête Loki fournie par la doc du lot 4) : poser `INTERSERVICE_AUTHZ_ENFORCE=1` dans `.env.server` et recréer les conteneurs. Rollback = retirer la variable.
