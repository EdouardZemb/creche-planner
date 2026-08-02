---
name: feature-contrat-enfant-id
description: Contrat ↔ enfant par référence enfantId (fin du couplage par prénom libre) — PR
metadata:
  node_type: memory
  type: project
  originSessionId: 9ae82815-6c8f-4a47-bcd8-10ba6ac7a0c4
---

Chantier **enfantId** (2026-07-05) : `contrat.enfant_id` (UUID svc-foyer) devient le lien de
référence ; `enfant` (prénom) = dénormalisation d'affichage rafraîchie par projection NATS.
**PR [#167](https://github.com/EdouardZemb/creche-planner/pull/167) ✅ MERGÉE main `e3eab39`
(2026-07-05, squash, CI 100 % verte e2e-stack/smoke-stack inclus)** (commits d'origine `9669098`

- fix seed `cb2aca1`, branche supprimée) — doc §27 de `docs/06-etat-davancement.md`.
  **PAS ENCORE DÉPLOYÉE EN PROD** (partira au prochain train de release).

**Design livré**

- svc-planification : migration `0005` (`enfant_id uuid` NULLABLE + `processed_event`), DTO
  créer/modifier avec `enfantId` requis, `ContratVue.enfantId: string|null`, **nouveau consumer
  JetStream du stream FOYER** (`consumers/`, durable `planification-foyer`, calqué tarification) :
  sur `foyer.EnfantModifie.v1` → refresh prénom des contrats de l'enfant + **ré-émission d'un
  `ContratModifie` par contrat touché** (aval notif/tarif rafraîchi sans code). Endpoint
  chirurgical `PUT /contrats/:id/enfant` (back-fill, idempotent, ne casse pas les plannings).
- Événements `ContratCree/ContratModifie` : `enfantId` **nullish optionnel** (additif, pattern
  `etablissementId` P2). `foyer.EnfantModifie.v1` existait déjà (rien côté svc-foyer).
- Back-fill : `scripts/backfill-enfants.mjs` (dry-run défaut, rapprochement par prénom PAR foyer,
  garde d'ambiguïté homonymes, vérif post-run). Prod : 8 contrats / 2 enfants, 0 homonyme attendu.

**Reste à faire (post-merge)**

1. Release train (migration `0005` additive, aucun secret/env nouveau ; contrats existants
   `enfant_id NULL` = UI fonctionnelle).
2. **Back-fill prod** post-déploiement : `node scripts/backfill-enfants.mjs` (dry-run) puis
   `--apply` via URLs internes `BACKFILL_FOYER_URL`/`BACKFILL_PLANIFICATION_URL`. Attendu : 8
   contrats, 2 enfants (Zoé/Mia), 0 homonyme.
3. Migration différée `enfant_id SET NOT NULL` dans un lot ultérieur (pendant de `0004`, à
   n'embarquer qu'après vérif `0 NULL` en prod).

**Pièges rencontrés (réutilisables)**

- Dépendance inter-contexte : ajouter la lib à `apps/<svc>/package.json` (`workspace:*`) + pnpm
  install, ET étendre `depConstraints` dans `eslint.config.mjs` (`context:planification` →
  `context:foyer`), sinon TS2307 + `@nx/enforce-module-boundaries`.
- Zod 4 `z.string().uuid()` strict (version 1-8, variant 8-b) : les UUID « 7777-7777… » des pacts
  passent `ParseUUIDPipe` mais PAS les corps Zod → utiliser des UUID v4 RFC dans les pacts.
- Couverture ratchet svc-planification (72 % lignes) : ne jamais abaisser → tester le
  `jetstream.consumer` (spec avec NATS factice + `vi.waitFor` pour la boucle async).
- `apps/api-gateway/src/e2e/parcours.e2e.spec.ts` **flaky en local Windows** sous parallélisme
  vitest (readiness gateway 30 s dépassée) : relancer avec `-- --no-file-parallelism`.
- Pacts : régénérer À BLANC (`Remove-Item pacts\*.json` + `nx test api-gateway`) — regénération
  idempotente vérifiée.
- La gateway n'expose PAS de `GET /foyers/:id/enfants` (seul POST) : lire les enfants via le
  dossier `GET /foyers/:id` → `{foyer, enfants, parents}` (a cassé smoke/e2e-stack, fix `cb2aca1`).

Liens : [[feature-etablissements-entite-libre]] (précédent back-fill/NOT NULL différé),
[[feature-contrats-besoins]], [[verif-ui-locale-stack]].
