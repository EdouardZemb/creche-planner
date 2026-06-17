# ADR-0004 — Décentralisation des contrats & exercice du versioning

- **Statut** : Accepté
- **Date** : 2026-06-04
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0001](0001-architecture-microservices.md) (microservices stricts),
  [ADR-0002](0002-grain-services-et-politiques-tarifaires.md)
- **Déclencheur** : audit d'architecture en lecture seule (2026-06-04, 2 agents : maturité
  microservices & analyse de couplage). Synthèse : maturité **84/100**, qualité du découplage
  **92/100**. Découplage **fort** sur le code et les données, **moyen** sur le runtime et les
  **contrats**. Le principal frein au « découplage maximum » visé par l'ADR-0001 est le
  **couplage de contrat centralisé**.

## Contexte

`libs/contracts` est aujourd'hui la **seule passerelle inter-contextes** autorisée par les
frontières Nx (`.eslintrc.json`, axe `context:` → `context:shared`). Elle agrège **tous** les
schémas Zod d'événements, DTO, enveloppes, OpenAPI et AsyncAPI de **tous** les bounded contexts.
Conséquences relevées par l'audit :

- `fan-in = 5` (les 4 services + la gateway en dépendent) ; c'est le point de couplage de
  contrat le plus structurant du dépôt.
- Un changement de schéma d'un contexte (ex. `foyer.FoyerMisAJour.v1`) **recompile et
  réimpacte** tous les consommateurs simultanément ; un changement non rétrocompatible n'est
  **pas isolable** par service.
- Le suffixe de version (`.v1`) est présent partout mais **jamais exercé** : aucune coexistence
  `.v1`/`.v2`, donc le versioning est **cosmétique** et ne protège pas réellement d'une rupture
  de contrat.
- `apps/web` ne dépend de **rien** dans `@creche-planner/*` (couplage compile-time nul) mais
  consomme l'API gateway **sans réutiliser les types de `contracts`** → couplage de contrat
  **implicite et non vérifié par le typage** (risque de dérive silencieuse `gateway.openapi.ts`
  ↔ types front).

Cette ADR **révise** le principe d'ADR-0001 / doc 06 §2 selon lequel « la seule passerelle
inter-contextes est `libs/contracts` » (lib monolithique), sans renoncer à la garantie de
frontières.

## Décision

**1. Segmenter `libs/contracts` par contexte.** Éclater la lib pivot en libs de contrat
**taguées par contexte** :

- `libs/contracts/kernel` (`type:contracts`, `context:shared`) — **uniquement** l'enveloppe
  `IntegrationEvent` (Zod), les types transverses (santé, erreurs homogènes) et les helpers
  d'enveloppe. C'est le seul contrat réellement partagé par tous.
- `libs/contracts/<contexte>` (`type:contracts`, `context:<contexte>`) — les **événements
  publiés** par ce contexte (ex. `contracts-foyer` porte `foyer.*`). Un service ne peut dépendre
  que des contrats **qu'il consomme réellement**, la règle `@nx/enforce-module-boundaries` le
  garantissant désormais par tag (un `context:foyer` ne peut pas tirer `contracts-tarification`).

**2. Exercer réellement le versioning d'événements.** Le consommateur **tolère N versions**
d'un contrat amont (décodage `v1` **et** `v2` coexistants), plutôt qu'un suffixe figé. Un test
de **rétro-compatibilité** garantit qu'un payload `v1` reste décodable après l'ajout d'un `v2`.

**3. Typer `apps/web` contre le contrat de la gateway.** Le front consomme le document OpenAPI
publié (`gatewayOpenApiDocument` / `GET /api/openapi.json`) comme **source de vérité typée** :
les types HTTP du front sont **dérivés** de ce contrat (pas réécrits à la main), de sorte qu'une
dérive de schéma gateway↔front devienne une **erreur de typecheck**, pas un bug runtime.

**4. Conserver l'enveloppe partagée.** `IntegrationEvent` (id/type/source/version/occurredAt/
traceId + payload) **reste** dans le kernel partagé : c'est un contrat de transport stable,
pas un couplage métier.

## Statu quo conservé (non-décisions assumées)

- **Le couplage runtime synchrone résiduel reste accepté** : la gateway appelle les services en
  HTTP (rôle de BFF) et le repli `svc-tarification → svc-planification`
  (`apps/svc-tarification/src/fallback/planification.client.ts`) demeure. Il sera **instrumenté**
  (métrique d'usage du repli) plutôt que supprimé (cf. doc 09 DEC-05) — sentinelle anti-
  « monolithe distribué ».
- **Le `shared-kernel` reste partagé** (`fan-in = 8`) : c'est un noyau de value objects pur et
  stable (I=0). Décision : le **discipliner** par un garde-fou (ne jamais y placer de logique
  applicative, cf. doc 09 DEC-07), pas le fragmenter.

## Conséquences

**Bénéfices attendus :**

- Couplage de contrat passant de **Moyen** à **Fort** : un changement de contrat n'impacte que
  les services qui consomment **ce** contexte ; la frontière Nx le **prouve** par tag.
- Versioning devenu **réel** : une évolution de contrat peut être déployée sans Big-Bang
  (coexistence `v1`/`v2`, migration progressive des consommateurs).
- Dérive front↔gateway **détectée au build**.

**Coûts acceptés :**

- Refactor mécanique mais **transverse** : déplacement de fichiers de schémas, mise à jour des
  imports dans les 4 services + gateway, ajout de tags/règles ESLint, régénération des barrels.
  Risque maîtrisé par le découpage en **lots à fichiers disjoints** (doc 10) et la garde des
  **pacts inchangés** (les contrats de test Pact restent la preuve de non-régression).
- Légère augmentation du nombre de projets Nx (une lib de contrat par contexte).

## Révision

Réversible : si la fragmentation des contrats s'avérait disproportionnée pour un projet
mono-utilisateur, re-consolider en une lib `contracts` unique est mécanique (les tags
`context:` redeviennent `context:shared`). La décision est **incrémentale** : elle peut s'arrêter
après l'étape 1 (segmentation) sans imposer les étapes 2-3.
