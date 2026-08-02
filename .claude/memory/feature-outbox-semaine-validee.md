---
name: feature-outbox-semaine-validee
description: "Événement notifications.SemaineValidee.v1 émis via outbox transactionnelle à la validation d'une semaine (svc-notifications) — PR"
metadata:
  node_type: memory
  type: project
  originSessionId: 0a6dbebc-8b5c-4ec3-929d-d4bc0d13c021
---

Chip dette (issu de [[feature-contrats-besoins]]) : la validation d'une semaine (`ValidationService.valider`, svc-notifications) n'émettait aucun événement NATS.

**Fait (2026-07-05, PR #168 ouverte, CI 100 % VERTE — check `ci` + e2e-stack + pact-can-i-deploy + 7 images ; mergeable CLEAN, prête à merger ; branche `claude/pensive-shirley-b47090`)** :

- Nouvelle lib `libs/contracts/notifications` (`@creche-planner/contracts-notifications`, tags `type:contracts`+`context:notifications`) — miroir exact de contracts-foyer (package.json avec exports `@creche-planner/source`, tsconfig×3, eslint, vitest) ; contrat `notifications.SemaineValidee.v1` `{ contratId, semaineIso, statut VALIDEE|VALIDEE_AVEC_MODIFS, deltaModifs? }` + asyncapi/notifications.md.
- Outbox svc-notifications : la table existait **latente depuis le Lot 0** (migration 0000) → aucune migration ; il suffisait de câbler `OutboxModule.forRoot({ source, table: schema.outbox })` dans app.module.ts.
- `valider()` : transaction + garde CAS `WHERE statut='A_VALIDER'` + `.returning()` → émission UNIQUEMENT à la transition réelle (revalidation idempotente et course concurrente perdante = 0 événement, état figé relu).

**Pièges rencontrés** :

- `context:notifications` n'a AUCUNE entrée depConstraints eslint (seul `type:app` contraint svc-notifications) → pas besoin de toucher eslint.config.mjs pour la nouvelle lib.
- zod v4 : `z.string().uuid()` = warning `no-deprecated` (ratchet) → utiliser `z.uuid()` ; `.readonly()` sur `z.array()` pour accepter les `readonly T[]` du domaine (DeltaModifs) sans friction TS.
- commitlint : header ≤ 100 caractères (hook husky).
- Worktree sans node_modules → `corepack pnpm@10.34.2 install` (~3 min) avant tout nx.

**Doc** : entrée ajoutée à `docs/06-etat-davancement.md` §23 (journal feature notifications) — l'événement + activation outbox ; ADR-0004 couvre déjà le pattern (lib contrat par contexte), pas de nouvel ADR.

**✅ MERGÉE main `a466496` (2026-07-05, squash via auto-merge, check `ci` vert 4m10s, branche distante supprimée)**.

**Reste** : release train (déploiement prod, pas encore fait) ; consommateurs pressentis de l'événement (audit/métriques, récap établissement auto) non implémentés — le contrat existe, à brancher.
