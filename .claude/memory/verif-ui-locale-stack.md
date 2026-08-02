---
name: verif-ui-locale-stack
description: "Recette pour vérifier l'UI web en local avec vraies données (stack Docker + Vite dev) et ses pièges"
metadata:
  node_type: memory
  type: project
  originSessionId: 02b03ece-dc11-441f-a8d9-ac81e8262470
---

Pour vérifier l'UI web en local avec de vraies données (audit UX, captures mobile) :

1. `docker compose up -d --build --wait web api-gateway svc-referentiel svc-foyer svc-planification svc-tarification svc-notifications` puis `node scripts/seed-demo.mjs --verify` (foyer de démo : id dans `scripts/.seed-demo-state.json`, enfants Zoé/Mia, 4 contrats).
2. Le conteneur `web` occupe :4200 → `docker compose stop web && docker compose rm -f web` pour le remplacer par Vite dev (`preview_start "web"` / `pnpm nx serve web`), qui proxifie `/api` → gateway Docker :3000. Le backend Docker reste en place.

**Pièges rencontrés (2026-07-03)** :

- `@creche-planner/shared-semaine` doit être buildée (`nx run-many -t build -p contracts-kernel shared-semaine`) sinon Vite 500 sur l'import (piège déjà connu pour `nx test web`).
- Si le clone est en retard sur le lockfile, `corepack pnpm@10.34.2 install` re-synchronise MAIS peut laisser des shims Windows périmés dans `apps/web/node_modules/.bin` (vite.CMD pointant vers l'ancien hash .pnpm → MODULE_NOT_FOUND). Fix : `rm -rf apps/web/node_modules/.bin` puis re-`pnpm install` (18 s, régénère).
- L'EncartValidation (semaine à valider) n'apparaît que si svc-notifications a proposé une semaine — le seed ne le fait pas par défaut. **Contournement (2026-07-04)** : insérer directement la ligne — `docker compose exec -T postgres-notifications psql -U notifications -d notifications -c "INSERT INTO notification_hebdo (id, contrat_id, foyer_id, semaine_iso, type, statut, snapshot) VALUES (gen_random_uuid(), '<contratId>', '<foyerId>', '<YYYY-Www>', 'VALIDATION_HEBDO', 'A_VALIDER', '{}') ON CONFLICT DO NOTHING;"` (`snapshot` `{}` est un `SnapshotSemaine` vide valide ; ids dans `scripts/.seed-demo-state.json`).

Lié : [[feature-notifications-planning]], [[pnpm-corepack-version]]
