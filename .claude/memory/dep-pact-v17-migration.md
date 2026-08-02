---
name: dep-pact-v17-migration
description: Migration @pact-foundation/pact 13->17 (Dependabot
metadata:
  node_type: memory
  type: project
  originSessionId: 6e23ce2c-5873-457d-b423-3043b1faa01c
---

Dependabot #98 (`@pact-foundation/pact` 13.2.0 → 17.0.1) : **fermée** puis remplacée par **PR #150 ✅ MERGÉE main `51374f5` (2026-07-03, squash)**. Déclaré dans les 6 services consommateur/provider Pact (api-gateway, svc-foyer, svc-notifications, svc-planification, svc-referentiel, svc-tarification).

**Pourquoi une PR dédiée** : la PR Dependabot version-only cassait le check `pact-drift` — le bump majeur change les métadonnées embarquées dans `pacts/*.json`, qu'un simple bump ne régénère pas.

**Migration = quasi drop-in** :

- **Zéro adaptation de code** : API `PactV3`/`MatchersV3` (consumer) et `Verifier` (provider) inchangées v13→v17. `pact-core` passe en 19.2.0.
- Node 24 (`.nvmrc`) satisfait le nouveau socle v17 (`>=22`, node 20 abandonné).
- Diff des pacts régénérés (`nx test api-gateway`) limité à : métadonnées (`pact-js`, `pactRust.ffi` 0.4.22→0.5.4 / `models` 1.2.3→1.3.11) + **suppression des buckets `matchingRules` vides (`header:{}`, `status:{}`)** que pact-core 19 n'émet plus. `pactSpecification` reste `3.0.0` → provider compatible.

**Pièges (pour le prochain bump pact)** :

- **`/pacts` est dans `.prettierignore`** (sortie déterministe pact-js) → lint-staged ne reformate PAS les contrats au commit ; sinon `pact-drift` casserait (compare la sortie brute vs commité).
- Repro locale de `pact-drift` : `rm pacts/*.json && NX_SKIP_NX_CACHE=true nx test api-gateway` → `git diff --exit-code -- pacts/` doit être vide. Vérif provider (Postgres) non reproductible en local Windows → couverte par le job CI `ci` (4 Postgres éphémères).
- Checks gardiens : `pact-drift` (AQ-02, régénère+diff), `pact-can-i-deploy` (matrice `can-i-deploy.mjs`, 5 paires api-gateway→provider). Voir [[audit-2026-07-plan-amelioration]] / [[dep-react-router-v7-migration]] (même topologie de PR de dépendance).
