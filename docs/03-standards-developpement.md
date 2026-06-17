# 03 — Standards de développement

> Statut : **Brouillon à valider** · Version 0.1 · 2026-06-02
> Règles qui pilotent _comment_ on écrit le code. Volontairement strictes mais
> proportionnées à un projet personnel : la qualité protège ta capacité à reprendre
> le projet dans 6 mois, pas une équipe de 50 personnes.

## 1. Principes directeurs

1. **Le domaine d'abord.** La logique de coût (doc 02) vit dans une couche `domain`
   pure : pas de framework, pas d'I/O, 100 % testable en mémoire.
2. **Architecture hexagonale (ports & adapters).** Le domaine définit des _ports_
   (interfaces) ; l'infrastructure fournit des _adapters_. Les dépendances pointent
   **vers l'intérieur** (règle de dépendance de la Clean Architecture).
3. **SOLID** appliqué pragmatiquement (cf. §4).
4. **Simplicité > ingéniosité.** YAGNI. On code le besoin du doc 01, pas l'imaginaire.
5. **Tout comportement métier est couvert par un test** avant d'être considéré fait.

## 2. Couches & règle de dépendance

```
            ┌─────────────────────────────────────────────┐
            │                  domain                       │  ← entités, value objects,
            │   (entities, value objects, domain services,  │     règles, ports (interfaces)
            │    ports = interfaces)   AUCUNE dépendance     │     PUR TypeScript
            ├─────────────────────────────────────────────┤
            │                application                    │  ← use cases / orchestrateurs,
            │   (use cases, command/query handlers)         │     dépend de `domain` uniquement
            ├─────────────────────────────────────────────┤
            │              infrastructure                   │  ← adapters: DB, HTTP, repos,
            │   (repos SQL, contrôleurs HTTP, mappers)      │     implémentent les ports
            └─────────────────────────────────────────────┘
```

- `domain` **n'importe rien** des couches externes ni d'un framework.
- `application` importe `domain`. Jamais l'inverse.
- `infrastructure` importe `application` + `domain` et **implémente** les ports.
- La direction des dépendances est **vérifiée automatiquement** (lint de frontières,
  cf. §7) — une violation casse la CI.

## 3. Conventions de code

- **Langage** : TypeScript en mode `strict` (`strict: true`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`). `any` interdit (sauf justification commentée).
- **Nommage** : `PascalCase` types/classes, `camelCase` variables/fonctions,
  `UPPER_SNAKE` constantes. Noms **métier** issus du glossaire (doc 02) : `tarifHoraire`,
  `mensualite`, `Foyer`, `ContratAccueil` — pas de `data`, `info`, `manager`, `helper`.
  Le vocabulaire métier reste en **français** (ubiquitous language) ; les mots-clés
  techniques restent en anglais.
- **Fonctions** : courtes, une responsabilité, ≤ ~30 lignes indicatives. Préférer
  les fonctions pures dans le domaine.
- **Immutabilité** : value objects immuables (`readonly`), pas de mutation cachée.
- **Monnaie & durée** : types dédiés `Money` (centimes entiers) et `Duree` (minutes
  entières). **Jamais** de `number` flottant pour un euro ou une heure.
- **Erreurs** : erreurs de domaine typées (`class TarifInvalideError extends DomainError`),
  jamais de `throw "string"`. Les invariants (doc 02 §4) lèvent à la construction.
- **Pas de commentaire qui paraphrase le code** ; commenter le _pourquoi_, jamais le _quoi_.
- **Validation aux frontières** : toute entrée externe (HTTP, DB) est validée par un
  schéma (Zod) avant d'entrer dans l'application.

## 4. SOLID — application concrète

| Principe | Application dans ce projet                                                       |
| -------- | -------------------------------------------------------------------------------- |
| **S**RP  | `CalculCoutMensuel` ne fait que calculer ; la persistance est ailleurs.          |
| **O**CP  | Ajouter un mode de garde (PAJE…) = nouvelle stratégie, sans toucher l'existant.  |
| **L**SP  | Tout adapter respecte le contrat de son port (tests de contrat partagés).        |
| **I**SP  | Ports fins : `PlanningRepository`, `ContratRepository` séparés, pas un god-repo. |
| **D**IP  | `application` dépend d'interfaces (`ports`), jamais d'implémentations concrètes. |

## 5. Stratégie de stratégie de tarif (extensibilité)

Le calcul du tarif est une **stratégie** derrière un port `PolitiqueTarifaire`.
v1 fournit `TarifPSU`. Un futur `TarifPAJE`/`TarifAssistanteMaternelle` s'ajoute
sans modifier le use case (OCP). C'est le seul point d'extension anticipé (YAGNI ailleurs).

## 6. Tests

- **Pyramide** : beaucoup d'unitaires (domaine), quelques tests d'intégration
  (adapters/DB), peu d'E2E (parcours UI critiques). Au sommet, un étage **E2E stack réelle**
  (`*.stack.e2e.spec.ts`) rejoue les parcours contre la pile dockerisée **sans mock réseau**
  (cf. doc 15).
- **Règle d'équipe (E2E stack réelle)** : _toute évolution qui touche un parcours utilisateur ajoute
  ou met à jour le test E2E stack réelle (`*.stack.e2e.spec.ts`) du parcours concerné._ Les régressions
  de la doc 14 (contrats invisibles, week-end « gardé ») sont passées **parce que l'E2E était mocké et
  que la CI ne démarrait pas la stack** : un test de parcours mocké ne valide aucune intégration réelle.
- **Domaine en TDD** : les cas CT-01..CT-07 (doc 02) sont écrits **avant** le code.
- **Tests de contrat de port** : une suite générique rejouée sur chaque adapter
  (ex. repo en mémoire ET repo SQL passent les mêmes tests) → garantit LSP.
- **Outils** : Vitest (unit/intégration), Playwright (E2E UI), Supertest (API).
- **Couverture** : objectif **100 % du domaine** (`domain/`), **enforced** par des seuils
  `vitest` bloquants (`libs/*/domain/vitest.config.mts`). Aucun seuil global chiffré n'est imposé
  sur les apps/contrats : la couverture y est **mesurée et publiée** en CI (lcov + json-summary,
  cf. [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 P1-2) **sans porte chiffrée** — la valeur
  n'est pas dans la métrique mais dans le test. La couverture est un garde-fou, pas un but ; pas de
  test « pour la métrique ».
- **Données de test** : pattern _Object Mother_ / _builders_ pour Foyer, Contrat, Planning.

## 7. Outillage & qualité

- **Gestionnaire de paquets** : `pnpm` (workspaces).
- **Monorepo** : Nx — enforce les **frontières de modules** (tags `domain`/`app`/`infra`
  → règle ESLint `@nx/enforce-module-boundaries`). C'est ce qui rend l'hexagonal _vérifiable_.
- **Lint/format** : ESLint (typescript-eslint) + Prettier. Règles : pas de `console.log`
  en prod, import boundaries, complexité cyclomatique plafonnée.
- **Hooks Git** : Husky + lint-staged (lint + format + types sur le staged), commit-msg
  via commitlint.
- **Type-check** : `tsc --noEmit` en CI, bloquant.

## 8. Git & livraison

- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- **Convention de correction (`fix:`)** : tout commit `fix:` porte dans son corps une ligne
  **« Cause racine : … — Prévention : … »** (la cause du défaut + l'action qui empêche sa réapparition).
  Le **test de non-régression** est par ailleurs systématique (principe §1.5). Cette traçabilité
  alimente le [registre d'anomalies](22-registre-anomalies.md) et la prévention des défauts (TMMi 5.1,
  cf. [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 P1-7).
- **Trunk-based léger** : `main` toujours verte ; branches courtes `feat/…` ; PR (même
  solo, pour la trace et la CI). Squash merge.
- **CI (GitHub Actions)** sur chaque PR : install → lint → type-check → test → build.
  Le merge est bloqué si rouge.
- **Versionnage** : SemVer ; `CHANGELOG.md` généré depuis les commits.

## 9. Definition of Done (par story)

Une story est _done_ quand :

1. Critères d'acceptation (doc 01) couverts par des tests **verts**.
2. Domaine concerné à 100 % de couverture.
3. Lint + type-check + frontières OK.
4. Pas de TODO non tracké ; questions `Q-xx` résolues ou explicitement reportées.
5. Doc mise à jour si une règle métier a changé.

## 9 bis. Standards spécifiques microservices

L'architecture retenue est **microservices** (doc 04, ADR-0001). En plus des règles
ci-dessus, qui s'appliquent **à l'intérieur de chaque service** :

- **Propriété des données** : un service ne lit/écrit **que** sa base. Toute donnée
  d'un autre contexte est obtenue par **API** ou répliquée en **read model** via
  événements — jamais par accès direct à une base étrangère.
- **Couplage par contrat** : les dépendances inter-services passent uniquement par
  `libs/contracts` (DTO/OpenAPI/AsyncAPI). Importer le `domain`/`infrastructure`
  d'un autre service est interdit (frontière Nx bloquante).
- **Événements** : nommés au passé métier (`ContratCréé`, `PlanningModifié`),
  versionnés, publiés via **outbox transactionnel**.
- **Idempotence** : tout consommateur d'événement déduplique par clé ; rejouer un
  événement n'a aucun effet de bord en double.
- **Résilience** : tout appel sortant a _timeout_, _retry_ à back-off et _circuit breaker_ ;
  dégradation propre si une dépendance est indisponible.
- **Tests de contrat (Pact)** : consumer-driven, **bloquants en CI**, pour chaque
  paire consommateur/fournisseur (BFF↔services, service↔service).
- **Observabilité par défaut** : _trace id_ propagé sur tous les appels et événements,
  logs JSON corrélés, `/health` (liveness/readiness) sur chaque service.
- **Versionnage d'API** (`/v1`) et évolutions rétro-compatibles ; dépréciation tracée.
- **Indépendance CI/CD** : chaque service se build/teste/déploie seul (Nx affected).

## 10. Documentation des décisions

Toute décision d'architecture structurante est consignée en **ADR** (Architecture
Decision Record) courte dans `docs/adr/NNNN-titre.md` (contexte / décision / conséquences).
