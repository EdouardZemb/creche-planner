---
name: nx-webpack-cli-pin
description: webpack-cli bumpé en ^7.1.0 — si tu bumps >5, renommer --node-env → --config-node-env dans les 6 targets build
metadata:
  node_type: memory
  type: project
  originSessionId: d106df74-d14d-4a79-bb4a-ea71dd6d6748
---

`webpack-cli` **est utilisé** (pas un vestige) : les 6 services (`api-gateway`, `svc-foyer`, `svc-notifications`, `svc-planification`, `svc-referentiel`, `svc-tarification`) buildent via `webpack-cli build` en exécuteur `nx:run-commands` dans leur `apps/*/package.json`, PAS via `@nx/webpack:webpack`. Le flag `--node-env=production` est **codé en dur** dans ces targets (pas généré à la volée par le plugin, contrairement à ce que je croyais avant).

**Résolution 2026-07-03 (reversal du pin `^5`) :** bumpé à **`^7.1.0`** — PR #151 (branche `chore/webpack-cli-7`), remplace Dependabot #94 (fermée). Seul breaking change v5→v7 impactant : `--node-env` supprimé (webpack-cli 6.0.0) → **`--config-node-env`**. Depuis 5.0.1 `--node-env` était déjà un alias de `--define-process-env-node-env` (renommé `--config-node-env` en 6.0.0) → renommage **1:1 sémantique**, comportement préservé. Validé `nx run-many -t build` 20/20 verts.

**How to apply:** si un `nx migrate` ou Dependabot rebump webpack-cli, ce n'est PLUS à refuser — il faut juste garder les 6 targets build sur `--config-node-env` (jamais revenir à `--node-env`, cassé depuis cli 6). Contraintes cli 7 : Node ≥20.9 (repo `>=24` OK), webpack ≥5.82 (repo 5.108.3 OK). Les builds services restent le canari. Voir [[audit-2026-07-plan-amelioration]].
