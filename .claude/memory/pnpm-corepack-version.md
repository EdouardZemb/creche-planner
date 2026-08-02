---
name: pnpm-corepack-version
description: 'Always run pnpm via corepack at the pinned version, not the global pnpm'
metadata:
  node_type: memory
  type: project
  originSessionId: d147ad2d-d3ae-4043-938b-b433fc4d07b8
---

Le repo épingle `packageManager: pnpm@10.34.2` (lockfileVersion 9.0). Le pnpm global de la machine est `8.15.1`, qui produit un format de lock incompatible → `pnpm install --frozen-lockfile` en CI casserait.

**Why:** générer/modifier `pnpm-lock.yaml` avec le mauvais pnpm rend la CI rouge.

**How to apply:** avant toute commande pnpm, faire `corepack prepare pnpm@10.34.2 --activate` puis appeler `corepack pnpm …` (et `corepack pnpm nx …`). Node attendu : 24.16.0 (`.nvmrc`).
