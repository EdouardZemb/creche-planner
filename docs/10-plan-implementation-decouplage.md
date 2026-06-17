# 10 — Plan d'implémentation : découplage & maturité micro-services

> Statut : **À valider** · Version 0.1 · 2026-06-04
> Met en œuvre la [spec 09](09-spec-decouplage-microservices.md) et la décision
> [ADR-0004](adr/0004-decentralisation-des-contrats.md). Découpé en **lots à fichiers disjoints**
> exécutables dans des **sessions Claude Code indépendantes** (en parallèle quand les dépendances
> le permettent), sans conflit de merge — même principe que la [doc 08](08-plan-implementation-ux.md).

## 1. Principe de découpage

- **Comportement gelé.** Aucune modification du calcul de coût ni du comportement observable
  (API, événements). La preuve de non-régression est : **pacts inchangés**, E2E API + Playwright
  verts, `nx run-many -t lint typecheck test build` vert.
- **Propriété de fichiers exclusive.** Chaque lot **possède** un ensemble de fichiers et ne
  touche **que** ceux-là (+ les specs voisines). Aucun fichier partagé entre deux lots
  parallèles → pas de conflit git.
- **Le Lot A est une fondation séquentielle.** Il restructure `libs/contracts` (segmentation par
  contexte) **et** met à jour les imports dans les services + les tags ESLint. C'est le seul lot
  qui touche transversalement les contrats ; il **précède** les lots qui en dépendent (B).
- **Une branche + une PR par lot** (`feat/decouplage-<lot>`), squash merge, CI verte obligatoire.

## 2. Graphe de dépendances

```
   ┌───────────────────────────────────────────────────────────┐
   │  LOT A — Segmentation des contrats + nettoyage frontières   │  ← séquentiel, à merger d'abord
   │  (DEC-01, DEC-10)                                            │
   └───────────────────────────────────────────────────────────┘
          │                 │
          ▼                 │            (indépendants de A — démarrables en parallèle dès le début)
   ┌──────────────┐         │      ┌──────────────┐ ┌──────────────┐
   │ LOT B        │         │      │ LOT C        │ │ LOT D        │
   │ Versioning   │ ◄───────┘      │ Typage web↔  │ │ Livraison +  │
   │ (DEC-02)     │                │ gateway      │ │ Pact broker  │
   └──────────────┘                │ (DEC-03)     │ │ (DEC-04/06)  │
          │                        └──────────────┘ └──────────────┘
          │   ┌──────────────┐ ┌──────────────┐
          └─► │ LOT E        │ │ LOT F        │
              │ Observ. repli│ │ Hygiène      │
              │ (DEC-05)     │ │ (DEC-07/08/09)│
              └──────────────┘ └──────────────┘
                          ▼
                 ┌─────────────────┐
                 │ LOT G — Intégr. │  ← après merge A→F
                 └─────────────────┘
```

| Lot | Dépend de          | Parallélisable avec | Surface                          |
| --- | ------------------ | ------------------- | -------------------------------- |
| A   | —                  | C, D                | contrats + ESLint + imports svc  |
| B   | A                  | C, D, E, F          | 1 contrat + 1 consommateur       |
| C   | — (OpenAPI publié) | A, B, D, E, F       | front `apps/web` (type layer)    |
| D   | —                  | A, B, C, E, F       | CI + release + pact broker       |
| E   | A                  | B, C, D, F          | observabilité + repli tarif      |
| F   | A                  | B, C, D, E          | lib résilience + Docker + kernel |
| G   | A→F                | (seul)              | intégration transverse           |

> **Note de séquencement** : C et D sont **réellement disjoints** de A (front OpenAPI ; CI/infra)
> et peuvent démarrer immédiatement. B/E/F touchent la surface des services et **attendent le
> merge de A** (qui réécrit les imports de contrats) pour éviter un rebase coûteux.

## 3. Definition of Done commune (tous les lots)

1. CA de la/les exigence(s) couverts par des **tests** verts (Vitest / contrat / lint selon le lot).
2. `pnpm nx affected -t lint typecheck test build` vert pour les projets touchés
   (et `run-many` complet au Lot G).
3. **Pacts inchangés** (sauf décision explicite documentée) ; vérifs provider toujours vertes.
4. Aucun fichier hors périmètre du lot modifié ; aucune dépendance npm ajoutée sans justification
   (cohérent ADR-0003 / Phases 7-8 « tout fait main »).
5. **Aucun changement de comportement** métier observable.
6. Commits Conventional Commits ; PR `feat/decouplage-<lot>` ; doc 06 mise à jour à la clôture.

---

## LOT A — Segmentation des contrats + nettoyage des frontières

**Exigences** : DEC-01 (🔴), DEC-10 (🟡). **Fondation séquentielle.**
**Nature** : déplacement de fichiers + réécriture mécanique d'imports + tags ESLint. Risque
**transverse** → isolé, mergé en premier.

**Fichiers possédés :**

- `libs/contracts/**` (restructuration en `kernel` partagé + `contracts-<contexte>` tagués)
- `.eslintrc.json` (nouveaux tags `context:` sur les libs de contrat ; **retrait/correction** des
  contraintes mortes `type:application`/`type:infrastructure` — DEC-10)
- les **imports de contrats** dans `apps/svc-*` et `apps/api-gateway` (chemins mis à jour)
- `tsconfig.json` racine (références des nouvelles libs)
- `pnpm-workspace.yaml` si de nouveaux chemins de libs apparaissent
- specs voisines des libs de contrat

**Tâches :**

1. Extraire un **kernel de contrat partagé** : enveloppe `IntegrationEvent`, types transverses
   (santé, erreurs homogènes), helpers d'enveloppe → `context:shared`, `type:contracts`.
2. Éclater les événements par contexte en libs `contracts-<contexte>` (`context:<contexte>`,
   `type:contracts`) — ex. `contracts-foyer` porte `foyer.*`.
3. Mettre à jour la règle `@nx/enforce-module-boundaries` : un `context:<X>` ne peut tirer que
   `contracts-<X>` + le kernel partagé. **Retirer/corriger** les contraintes mortes (DEC-10).
4. Réécrire les imports dans les services + gateway (mécanique) ; régénérer barrels/exports.
5. Vérifier par un **test négatif** qu'un import inter-contexte interdit fait **échouer le lint**
   (DEC-01/CA2), et par `pnpm nx graph` que le fan-in par contexte est réduit (CA3).

**DoD spécifique** : pacts inchangés, vérifs provider vertes, `nx run-many -t lint typecheck test
build` vert sur **tous** les projets ; graphe Nx montrant la réduction du couplage de contrat.

---

## LOT B — Exercice réel du versioning d'événements

**Exigences** : DEC-02 (🟠). **Dépend de** : Lot A (libs de contrat segmentées).

**Fichiers possédés :**

- la lib de contrat du contexte choisi (ex. `libs/contracts/contracts-foyer/**`) — ajout du
  schéma `v2`
- le **consommateur** concerné (ex. `apps/svc-tarification/src/consumers/projection.service.ts`
  ou son décodeur) — dispatch par `version`
- les specs voisines (test de rétro-compatibilité)

**Tâches :**

1. Choisir un événement amont (ex. `foyer.FoyerMisAJour`) et créer un **`v2`** rétrocompatible
   (champ optionnel ajouté).
2. Faire **coexister** `v1` et `v2` dans la lib de contrat (deux schémas Zod, sélection par
   `version` de l'enveloppe).
3. Adapter le consommateur pour **décoder `v1` ET `v2`** (CA2).
4. Écrire un **test de rétro-compatibilité** : un payload `v1` historique reste décodable après
   l'ajout du `v2` (CA3). Ne pas régénérer les pacts (le contrat HTTP gateway est inchangé).

---

## LOT C — Typage de `apps/web` contre l'OpenAPI de la gateway

**Exigences** : DEC-03 (🟠). **Front-only**, indépendant de A.

**Fichiers possédés :**

- `apps/web/src/api/**` (couche de types/clients HTTP dérivée du contrat)
- les fichiers front qui **redéclarent à la main** des types BFF (à remplacer par les types dérivés)
- specs voisines

**Tâches :**

1. Faire de `gatewayOpenApiDocument` (`GET /api/openapi.json`) la **source de vérité typée** :
   dériver les types des réponses/requêtes BFF depuis ce contrat (sans réécriture manuelle).
2. Remplacer les types HTTP écrits à la main par les types dérivés ; **une divergence devient une
   erreur `web:typecheck`** (CA2).
3. Pas de dépendance npm nouvelle non justifiée ; rester strictement dans `apps/web` (CA3).

> ⚠️ Si une génération de types depuis OpenAPI nécessite un outil, **préférer** un script de
> dérivation interne (cohérent « tout fait main ») ; toute dépendance doit être justifiée en PR.

---

## LOT D — Livraison indépendante & registre de contrats

**Exigences** : DEC-04 (🟠), DEC-06 (🟡). **Indépendant de A** (CI/infra).

**Fichiers possédés :**

- `nx.json` / `project.json` (config `nx release` : versionnement + changelog par projet)
- `.github/workflows/**` (jobs/matrix par service via `nx affected` ; publication d'images
  taguées par service ; intégration Pact Broker / `can-i-deploy`)
- `docs/exploitation/runbook-deploiement.md` (déploiement d'un **service isolé**)
- (option) configuration du Pact Broker, ou **ADR** documentant le maintien des pacts fichiers

**Tâches :**

1. Activer `nx release` : versionnement/changelog **par projet** (fin du `0.0.1` figé) — DEC-04/CA1.
2. CI : construire/taguer une **image par service** déclenchée par `nx affected` (un service non
   modifié n'est pas republié) — DEC-04/CA2.
3. Pact Broker **ou** vérification `can-i-deploy` en CI (publier + vérifier compat) ; à défaut,
   **ADR** assumant les pacts fichiers et leurs limites — DEC-06.
4. Documenter le **déploiement isolé d'un service** dans le runbook — DEC-04/CA3.

> Ne touche **pas** au `Dockerfile` (optimisation = Lot F) ni au comportement des services.

---

## LOT E — Observabilité du repli synchrone

**Exigences** : DEC-05 (🟠). **Dépend de** : Lot A (surface svc-tarification stabilisée).

**Fichiers possédés :**

- `apps/svc-tarification/src/fallback/planification.client.ts` (incrément de métrique sur repli)
- `libs/observability/**` (helper de métrique compteur, si nécessaire)
- `docker/grafana/**`, `docker/prometheus/**` (dashboard/alerte du repli)
- `docs/exploitation/observabilite.md`

**Tâches :**

1. Incrémenter un **compteur Prometheus** à chaque usage du repli tarif→planif (CA1) — sans
   changer la **condition** de déclenchement (comportement inchangé, CA3).
2. Exposer la métrique (collector OTel / endpoint Prometheus existant) ; ajouter un **panneau
   Grafana** + alerte de seuil (« repli trop fréquent ») — CA2.
3. Documenter la métrique et son interprétation dans `observabilite.md`.

> Touche `planification.client.ts` mais **pas** `resilience.ts` (Lot F) : fichiers disjoints.

---

## LOT F — Hygiène de découplage (résilience, Docker, kernel)

**Exigences** : DEC-07 (🟡), DEC-08 (🟡), DEC-09 (🟡). **Dépend de** : Lot A.

**Fichiers possédés :**

- `libs/resilience/**` _(nouvelle lib `type:infrastructure`, `context:shared`)_ — circuit
  breaker / retry / `fetchAvecTimeout` factorisés
- `apps/api-gateway/src/clients/resilience.ts` + `apps/svc-tarification/src/fallback/resilience.ts`
  (deviennent de **fines réexports/adaptateurs** de la lib partagée — variantes propagation vs
  repli conservées)
- `Dockerfile` (multi-stage par service) ; `docker-compose.yml` (build args/ciblage par service)
- `libs/shared-kernel/**` (uniquement l'**ajout du garde-fou** : test/lint anti-logique applicative)
- specs voisines

**Tâches :**

1. **DEC-08** : créer `libs/resilience` ; y déplacer le code commun ; faire importer gateway et
   tarification au lieu de dupliquer (garder les deux comportements : `executerResilient` /
   `executerOuRepli`). Frontières respectées.
2. **DEC-09** : `Dockerfile` multi-stage ciblant `dist/apps/<svc>` + `node_modules` élagué
   (réutiliser `prune-lockfile`) ; `docker compose up --build` vert, health checks OK.
3. **DEC-07** : garde-fou automatisé garantissant que `shared-kernel` reste **pur** (zéro
   framework, `fan-out = 0`).

> ⚠️ `resilience.ts` (Lot F) et `planification.client.ts` (Lot E) sont **disjoints** ; `Dockerfile`
> (Lot F) et la CI/`nx release` (Lot D) sont **disjoints**. Pas de conflit.

---

## LOT G — Intégration & vérification transverse

**Exigences** : vérification globale des critères de succès (spec 09 §5).
**Dépend de** : merge des lots A→F.

**Fichiers possédés :** ajustements transverses légers + docs.

**Tâches :**

1. `pnpm nx run-many -t lint typecheck test build` vert sur **tous** les projets ; `format:check` OK.
2. Rejouer les **vérifs Pact provider** (CI/Docker) et l'**E2E** (API + Playwright) — non-régression.
3. Vérifier par `pnpm nx graph` la **réduction effective du couplage de contrat** (fan-in par
   contexte) et l'absence de cycle.
4. Mettre à jour la **doc 06** (§ Phase 11) et cocher la DoD de la **doc 05** (Phase 11).
5. Mettre à jour le tableau de maturité (viser Contrat **Fort**, Runtime **Moyen-instrumenté**).

---

## 4. Lancement des sessions (procédure)

1. **Session Lot A** d'abord (fondation contrats) ; en parallèle, **Lots C et D** (disjoints).
   Merger A.
2. Une fois A sur `main`, lancer **en parallèle** les **Lots B, E, F** (fichiers disjoints).
3. Merger B→F (ordre indifférent ; CI verte par PR).
4. **Session Lot G** en dernier (intégration + docs).

## 5. Prompts de lancement (à coller dans chaque session)

> Préambule commun à coller en tête de **chaque** prompt :
>
> « Projet `creche-planner` (Nx monorepo microservices). Lis d'abord
> `docs/09-spec-decouplage-microservices.md`, `docs/10-plan-implementation-decouplage.md` et
> `docs/adr/0004-decentralisation-des-contrats.md`. Tu réalises **uniquement le lot indiqué** : ne
> modifie **que** les fichiers listés. **Comportement gelé** : pacts inchangés, aucun changement
> de calcul/API/événement observable. Respecte les standards `docs/03` et les pièges `docs/06 §5`
> (imports `.js`, tags `type/context`, domaine TS pur, `**/node_modules` en `.eslintrc.json`,
> chemins `../../../` des libs imbriquées). Termine par `pnpm nx affected -t lint typecheck test
build` vert. Crée une branche `feat/decouplage-<lot>` et ouvre une PR. »

- **Lot A** : « …Réalise le **LOT A — Segmentation des contrats** (DEC-01/DEC-10). Éclate
  `libs/contracts` en kernel partagé + `contracts-<contexte>` tagués `context:<X>`, mets à jour la
  règle de frontières (et retire les contraintes mortes), réécris les imports des services.
  Prouve par un test négatif qu'un import inter-contexte échoue au lint. Pacts inchangés. »
- **Lot B** : « …Réalise le **LOT B — Versioning exercé** (DEC-02) après merge de A. Crée un `v2`
  rétrocompatible d'un événement, fais coexister v1/v2, décode les deux côté consommateur, ajoute
  un test de rétro-compatibilité. »
- **Lot C** : « …Réalise le **LOT C — Typage web↔gateway** (DEC-03). Dérive les types HTTP de
  `apps/web` depuis l'OpenAPI publié ; une divergence doit casser `web:typecheck`. Front-only. »
- **Lot D** : « …Réalise le **LOT D — Livraison indépendante** (DEC-04/DEC-06). Active `nx release`
  par projet, CI image-par-service via `nx affected`, Pact Broker/`can-i-deploy` (ou ADR), runbook
  de déploiement isolé. Ne touche pas au Dockerfile. »
- **Lot E** : « …Réalise le **LOT E — Observabilité du repli** (DEC-05) après merge de A.
  Incrémente une métrique Prometheus sur chaque repli tarif→planif (sans changer la condition),
  ajoute panneau Grafana + alerte, documente dans `observabilite.md`. »
- **Lot F** : « …Réalise le **LOT F — Hygiène** (DEC-07/08/09) après merge de A. Factorise la
  résilience dans `libs/resilience`, optimise le `Dockerfile` (multi-stage par service), ajoute le
  garde-fou de pureté du `shared-kernel`. »
- **Lot G** : « …Réalise le **LOT G — Intégration** après merge A→F. run-many complet, rejoue
  pacts + E2E, vérifie la réduction de couplage par `nx graph`, mets à jour docs 05/06. »

## 6. Risques & parades

| Risque                                               | Parade                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Refactor de contrats casse un import dans un service | Lot A **isolé et mergé en premier** ; réécriture mécanique + `nx run-many` vert bloquant. |
| Régression silencieuse de comportement               | **Pacts inchangés** + E2E API/Playwright = filet ; aucun lot ne touche `libs/*-domain`.   |
| Conflit `Dockerfile` (Lot D vs F)                    | Lot D = **CI/release uniquement** ; Lot F = **Dockerfile**. Surfaces disjointes.          |
| Conflit `.eslintrc.json` (DEC-01 vs DEC-10)          | Les deux dans le **même Lot A** ; aucun autre lot n'édite `.eslintrc.json`.               |
| `resilience.ts` touché par E et F                    | E possède `planification.client.ts`, F possède `resilience.ts` (fichiers disjoints).      |
| Dépendance npm pour OpenAPI→types (Lot C)            | Préférer un script de dérivation interne ; toute dépendance justifiée en PR.              |
| Versioning v2 régresse un consommateur               | Test de **rétro-compatibilité** obligatoire ; v2 **rétrocompatible** (champ optionnel).   |
