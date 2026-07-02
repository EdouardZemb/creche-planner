# Contribuer

Point d'entrée court. Les références détaillées : [CONVENTIONS.md](CONVENTIONS.md)
(conventions TS/React outillées), [doc 03](docs/03-standards-developpement.md)
(standards complets) et l'[index de la documentation](docs/README.md).

## Prérequis

- **Node 24 LTS** — version figée dans [`.nvmrc`](.nvmrc).
- **pnpm via corepack uniquement** : `corepack pnpm@10.34.2 …` (la version est
  pilotée par le champ `packageManager` de `package.json`). Ne pas utiliser un
  pnpm installé globalement — un pnpm 8.x régénérerait un lockfile incompatible.
- **Docker Desktop** — requis seulement pour la pile locale et les e2e stack.

## Commandes de base

```bash
corepack pnpm install

# Qualité (lint + type-check + tests + build sur les projets affectés)
corepack pnpm nx run-many -t lint typecheck test build

# Un seul projet — toujours coupler typecheck et test :
corepack pnpm nx run-many -t typecheck test -p web
# ⚠️ `nx test <projet>` seul ne vérifie PAS les types (Vitest transpile sans type-check).

# Pile locale complète / E2E stack réelle
docker compose up --build
corepack pnpm e2e:stack
```

## Workflow PR

1. **`main` est protégée** : aucune modification directe. Une branche dédiée par
   sujet → PR → merge quand le check **`ci`** est vert (requis par la protection
   de branche).
2. **Commits conventionnels, en français** : `feat(...)`, `fix(...)`, `docs(...)`,
   `chore(...)`… — vérifiés par commitlint au pre-commit (husky + lint-staged,
   qui applique aussi prettier/eslint sur les fichiers stagés).
3. **Une PR = un sujet.** La spec précède le code : toute fonctionnalité
   substantielle commence par une doc dans [`docs/`](docs/README.md).
4. Vulnérabilités : voir [SECURITY.md](SECURITY.md) (ne pas ouvrir d'issue publique).
