---
name: repo-clean-clone-location
description: Work from the -public clean clone; the original creche-planner dir must never be pushed/pulled
metadata:
  node_type: memory
  type: project
  originSessionId: d147ad2d-d3ae-4043-938b-b433fc4d07b8
---

Travailler depuis le clone PROPRE `…/Documents courtier/creche-planner-public` (remote `github.com/EdouardZemb/creche-planner`, public). Le dossier original `…/Documents courtier/creche-planner` a un HEAD local sur l'ancienne histoire privée → **push/pull interdits** depuis là.

**Why:** un push depuis l'ancien clone exposerait/écraserait l'histoire publique.

**How to apply:** toujours opérer dans `-public`. `main` est protégée (PR obligatoire, check `ci` requis strict, pas de push direct) → brancher depuis `origin/main` à jour et ouvrir une PR. Ne jamais `git add -A`/`.` — ajouter les fichiers nommément. Voir [[pnpm-corepack-version]].
