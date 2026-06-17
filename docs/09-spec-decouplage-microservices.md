# 09 — Spécification : découplage & maturité micro-services

> Statut : **À valider** · Version 0.1 · 2026-06-04
> Décrit le _quoi_ et le _pourquoi_ du **durcissement architectural** visant le
> « découplage maximum » de l'[ADR-0001](adr/0001-architecture-microservices.md). Le _comment_
> (lots, fichiers, prompts de session) est dans la [doc 10](10-plan-implementation-decouplage.md).
> Décision structurante associée : [ADR-0004](adr/0004-decentralisation-des-contrats.md).
> Complète la doc 04 (architecture & technos) sans la remplacer.

## 1. Contexte & motivation

Un **audit d'architecture en lecture seule** (2026-06-04, 2 agents : maturité micro-services &
analyse quantitative de couplage) a confirmé que `creche-planner` est une **authentique
architecture micro-services** — pas un monolithe modulaire déguisé : 4 services + 1 gateway
déployables, **base-par-service stricte**, bus d'événements **NATS JetStream**, **outbox
transactionnel**, **idempotence effectively-once**, **résilience** (circuit breaker/retry/
timeout), **contract testing Pact bloquant**, **observabilité distribuée** (OpenTelemetry →
Tempo/Prometheus/Grafana).

**Scores de l'audit :** maturité micro-services **84/100** ; qualité du découplage (graphe)
**92/100** ; **zéro dépendance circulaire** ; principe des dépendances stables (SDP) respecté ;
frontières Nx en `error` **sans contournement** (lint vert sur 13 projets).

| Dimension de découplage | Niveau audité | Cible de cette spec |
| ----------------------- | ------------- | ------------------- |
| Code                    | **Fort**      | maintenu Fort       |
| Données                 | **Fort**      | maintenu Fort       |
| Runtime                 | **Moyen**     | Moyen → instrumenté |
| Contrat                 | **Moyen**     | **Moyen → Fort**    |

Objectif de ce lot : porter le découplage de _« fort sur le code/données »_ à _« fort sur les
contrats et la chaîne de livraison »_, **sans casser** les pacts ni le comportement métier.

## 2. Périmètre

### Dans le périmètre

- **Contrats** : segmentation de `libs/contracts` par contexte (ADR-0004), exercice réel du
  versioning d'événements, typage de `apps/web` contre l'OpenAPI de la gateway.
- **Chaîne de livraison** : versionnement/release **par service** (`nx release`), pipelines/jobs
  CI **par projet**, registre Pact (broker / `can-i-deploy`) au lieu de pacts commités à plat.
- **Runtime** : **instrumentation** du repli synchrone tarif→planif (métrique), sans le supprimer.
- **Hygiène de découplage** : factorisation de `resilience.ts` dupliqué, Dockerfiles optimisés
  par service, garde-fou sur `shared-kernel`, nettoyage des règles de frontières mortes.

### Hors périmètre

- Toute modification du **calcul de coût** (`libs/*-domain`) ou du **comportement métier** observable.
- Suppression du couplage runtime synchrone gateway→services (inhérent au rôle de BFF) ou du
  **repli** tarif→planif (on l'**instrumente**, on ne le retire pas — cf. ADR-0004).
- Fragmentation du `shared-kernel` (décision : le discipliner, pas l'éclater — ADR-0004).
- Migration d'orchestration (Kubernetes, service mesh) : reste backlog (doc 05 Phase 9).
- Changement du **comportement** des contrats existants : les **pacts restent inchangés** et
  servent de garde-fou de non-régression.

> ⚠️ **Contrainte forte** : ce durcissement ne doit **rien changer au comportement observable**
> (API, événements, calculs). La preuve de non-régression est : **pacts inchangés**, E2E API et
> Playwright verts, `nx run-many -t lint typecheck test build` vert sur tous les projets.

## 3. Principes directeurs

1. **La frontière prouve le découplage.** Tout couplage de contrat réduit doit être **garanti
   par un tag Nx** et la règle `@nx/enforce-module-boundaries`, pas seulement par convention.
2. **Versionner, c'est tolérer.** Un contrat versionné n'a de valeur que si le consommateur sait
   décoder **plusieurs versions** simultanément.
3. **Découpler la livraison, pas seulement le code.** Des services déployables indépendamment
   doivent être **versionnés et publiés** indépendamment.
4. **Instrumenter le couplage résiduel.** Ce qu'on ne supprime pas (repli sync), on le **mesure**
   pour qu'il reste exceptionnel.
5. **Ne pas régresser le comportement.** Pacts, E2E et calculs sont le filet ; toute exigence se
   valide avec eux verts.
6. **Incrémental et réversible.** Chaque exigence est livrable seule ; l'ensemble est arrêtable
   après la segmentation des contrats sans dette.

## 4. Exigences

Chaque exigence porte une **priorité** issue de l'audit (🔴 P0 structurant · 🟠 P1 important ·
🟡 P2 hygiène) et des **critères d'acceptation (CA)** testables.

### DEC-01 — Segmentation de `libs/contracts` par contexte 🔴

Réduire le couplage de contrat centralisé (ADR-0004, décision 1).

- **CA1** L'enveloppe `IntegrationEvent` et les types transverses vivent dans un **kernel de
  contrat partagé** (`context:shared`) ; les événements d'un contexte vivent dans une lib
  **taguée `context:<contexte>`**.
- **CA2** La règle `@nx/enforce-module-boundaries` **empêche** un service de dépendre des
  contrats d'un contexte qu'il ne consomme pas (vérifié par un test/lint qui échoue si on tente
  l'import interdit).
- **CA3** `pnpm nx graph` montre que chaque service ne tire que les contrats des contextes qu'il
  **consomme réellement** (ex. `svc-foyer` ne dépend plus des schémas `planification`).
- **CA4** **Pacts inchangés**, vérifs provider toujours vertes ; `nx run-many -t lint typecheck
test build` vert sur tous les projets.

### DEC-02 — Exercice réel du versioning d'événements 🟠

Rendre le suffixe `.vN` opérant (ADR-0004, décision 2).

- **CA1** Au moins un contrat d'événement expose une **coexistence `v1`/`v2`** (un champ ajouté
  en `v2`, `v1` toujours valide).
- **CA2** Le consommateur concerné **décode `v1` et `v2`** (dispatch par `version` de l'enveloppe)
  sans planter sur l'ancienne version.
- **CA3** Un **test de rétro-compatibilité** vérifie qu'un payload `v1` historique reste décodable
  après l'introduction de `v2` (garde anti-rupture).

### DEC-03 — Typage de `apps/web` contre l'OpenAPI de la gateway 🟠

Supprimer le couplage de contrat **implicite** front↔gateway (ADR-0004, décision 3).

- **CA1** Les types HTTP de `apps/web` sont **dérivés** du contrat publié (`gatewayOpenApiDocument`
  / `GET /api/openapi.json`), pas réécrits à la main.
- **CA2** Une divergence entre le contrat gateway et l'usage front provoque une **erreur de
  typecheck** (`web:typecheck` échoue), pas un bug runtime.
- **CA3** Aucune dépendance npm nouvelle non justifiée ; front-only (`apps/web`).

### DEC-04 — Release & versionnement indépendants par service 🟠

Exploiter la déployabilité indépendante au niveau de la **livraison** (audit §3).

- **CA1** `nx release` (ou équivalent) produit un **versionnement et un changelog par projet**
  (fin du `0.0.1` figé partagé).
- **CA2** La CI construit/tague une **image par service** déclenchée par `nx affected`
  (un service non modifié n'est pas republié).
- **CA3** La documentation d'exploitation (`docs/exploitation/runbook-deploiement.md`) décrit le
  **déploiement d'un service isolé** (pas seulement « tout en bloc »).

### DEC-05 — Instrumentation du repli synchrone tarif→planif 🟠

Garder le repli mais le rendre **observable** (ADR-0004, statu quo ; audit §5 anti-pattern).

- **CA1** Chaque usage du repli `svc-tarification → svc-planification`
  (`apps/svc-tarification/src/fallback/planification.client.ts`) **incrémente une métrique**
  (compteur exporté Prometheus).
- **CA2** Un **dashboard/alerte** (ou au minimum une métrique documentée dans
  `docs/exploitation/observabilite.md`) permet de vérifier que le repli reste **exceptionnel**.
- **CA3** Comportement fonctionnel **inchangé** (le repli déclenche toujours dans les mêmes cas).

### DEC-06 — Registre de contrats (Pact Broker / can-i-deploy) 🟡

Remplacer les pacts commités à plat par une vérification de compatibilité au déploiement (audit §3).

- **CA1** Un **Pact Broker** (ou une vérification `can-i-deploy` équivalente) est intégré à la CI,
  ou à défaut un **ADR documente** le choix de rester en pacts fichiers avec ses limites.
- **CA2** Si broker : la CI **publie** les pacts et **vérifie** la compatibilité avant un
  déploiement simulé.

### DEC-07 — Garde-fou sur le `shared-kernel` 🟡

Discipliner le hub `fan-in = 8` sans le fragmenter (ADR-0004, statu quo).

- **CA1** Un **garde-fou automatisé** (test/lint) échoue si `libs/shared-kernel` importe une
  dépendance framework ou de la logique applicative (il ne doit contenir que des **value objects
  purs** : `Money`, `Duree`, `Tranche`, `DomainError`).
- **CA2** La règle de frontières confirme que `shared-kernel` reste à **`fan-out = 0`** (ne dépend
  de rien).

### DEC-08 — Factorisation de `resilience.ts` dupliqué 🟡

Supprimer la duplication relevée entre gateway et tarification (audit §2.3 / faiblesse 4).

- **CA1** Le code de résilience (circuit breaker / retry / `fetchAvecTimeout`) vit dans **une
  seule lib partagée** (ex. `libs/observability` ou `libs/resilience`, `type:infrastructure`).
- **CA2** `apps/api-gateway/src/clients/resilience.ts` et
  `apps/svc-tarification/src/fallback/resilience.ts` **importent** cette lib au lieu de la
  dupliquer (les deux variantes — propagation vs repli — restent disponibles, pas réécrites).
- **CA3** Frontières respectées ; pacts/E2E verts.

### DEC-09 — Dockerfiles optimisés par service 🟡

Rendre les images réellement indépendantes et minimales (audit §3 / faiblesse 5).

- **CA1** Chaque service produit une **image multi-stage** ciblant son seul `dist/apps/<svc>` +
  `node_modules` élagué (réutiliser le `prune-lockfile` déjà présent), au lieu d'un `COPY` du
  workspace entier.
- **CA2** `docker compose up --build` reste vert ; les health checks par service passent.

### DEC-10 — Nettoyage des règles de frontières mortes 🟡

Supprimer le _dead config_ relevé dans `.eslintrc.json` (audit §3 / réserve).

- **CA1** Les contraintes `type:application` / `type:infrastructure` qui référencent des tags
  **non utilisés** (les apps portent `type:app`) sont soit **corrigées** pour correspondre aux
  tags réels, soit **retirées**.
- **CA2** `nx run-many -t lint` reste vert ; aucune frontière réelle affaiblie.

## 5. Critères de succès produit

1. **Contrats découplés et prouvés** : un service ne compile qu'avec les contrats qu'il consomme,
   garanti par tag (DEC-01) ; versioning exercé (DEC-02) ; front typé contre la gateway (DEC-03).
2. **Livraison indépendante** : versionnement + image par service via `nx affected` (DEC-04).
3. **Couplage résiduel mesuré** : le repli sync est observable et reste exceptionnel (DEC-05).
4. **Hygiène** : zéro duplication de résilience, images minimales, kernel discipliné, config de
   frontières propre (DEC-06..10).
5. **Non-régression absolue** : **pacts inchangés**, E2E API + Playwright verts, `nx run-many -t
lint typecheck test build` vert sur tous les projets ; **aucun changement de comportement**
   métier observable.

## 6. Traçabilité audit → exigences

| Constat d'audit (priorité)                                   | Exigence(s) |
| ------------------------------------------------------------ | ----------- |
| P0-1 couplage de contrat centralisé (`libs/contracts`)       | DEC-01      |
| P0-2 versioning `.v1` cosmétique (pas de coexistence)        | DEC-02      |
| Web non typé contre `contracts` (couplage implicite)         | DEC-03      |
| P1-1 pas de release/versionnement indépendant (`0.0.1` figé) | DEC-04      |
| P1-3 repli sync tarif→planif non instrumenté                 | DEC-05      |
| P1-2 pacts commités sans broker                              | DEC-06      |
| `shared-kernel` fan-in 8 sans garde-fou                      | DEC-07      |
| P2-1 `resilience.ts` dupliqué gateway/tarification           | DEC-08      |
| P2-2 Dockerfile générique copiant tout le workspace          | DEC-09      |
| Règles `type:application/infrastructure` mortes en ESLint    | DEC-10      |
