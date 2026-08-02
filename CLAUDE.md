<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Contexte projet pour les sessions distantes

Ce dépôt embarque son propre contexte de travail, pour qu'une session lancée
ailleurs que sur le poste de l'auteur (Claude Code sur le web, autre machine)
reparte avec le même historique de décisions.

- **`.claude/memory/MEMORY.md`** — index de la mémoire projet : un fichier par
  sujet (chantiers livrés, pièges connus, faits de prod). **À lire en début de
  session** ; les fiches `piege-*.md` évitent de re-diagnostiquer des faux
  positifs déjà tranchés.
- **`.claude/plans/`** — plans de chantier détaillés (lots, décisions, critères
  d'acceptation). Le plan est la source de vérité du découpage en lots.
- **`docs/06-etat-davancement.md`** — journal d'avancement fonctionnel.

Si une session distante apprend un fait durable (piège, décision, état de
prod), l'écrire dans `.claude/memory/` et l'indexer dans `MEMORY.md` : c'est
la seule voie pour qu'il revienne sur le poste principal.

## Ce qui n'est PAS faisable hors du réseau local

- **Déploiement et vérification prod** : le serveur n'est joignable qu'en LAN
  (`ssh edouard@<ip-lan>`), et les clés sops+age vivent sur le serveur. Aucun
  `deploy.mjs`, aucun rejeu de projection depuis une session distante.
- **Stack Docker locale** : seed, `e2e-stack` et `web:e2e-visuel` supposent la
  pile compose locale. Les vérifications visuelles se font sur le poste ou en CI.

Une session distante produit donc du **code et des PR** ; les releases et les
vérifications live attendent un accès au poste principal.
