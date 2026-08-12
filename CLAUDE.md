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

# Commandes clés du dépôt

- Toujours `corepack pnpm@10.34.2 …`, jamais le pnpm global (une autre majeure
  réécrit `pnpm-lock.yaml` dans un format que la CI refuse).
- `pnpm preflight` en début de session (le hook SessionStart le lance
  automatiquement) : vérifie l'environnement complet — pnpm, Node, arbre de
  travail, liens workspace, binaires installés, chaîne Nx, ports Pact, hooks
  git — en quelques secondes, zéro réseau.
- `pnpm check` avant de pousser (`lint typecheck test build` sur tout le
  workspace) ; `pnpm pieges` et `pnpm frontieres` sont des steps bloquants du
  job `ci`, rejouables en local en < 1 s.
- Vérité sur le format : `git diff`, jamais `prettier --check` local (artefact
  CRLF sous Windows — cf. la fiche mémoire dédiée).
- Refonte CSS/web : prouver l'iso-rendu avec `nx run web:e2e-visuel` puis
  `node scripts/comparer-empreinte.mjs avant.json apres.json` (poste ou CI
  uniquement, la pile locale est requise).

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
- **`.claude/commands/`** — commandes slash du projet : `/executer-lot` (le
  rituel d'exécution d'un lot de plan), `/recherche-pistes` (cartographie des
  pistes d'amélioration), `/upgrade-qualite-mobile` (audit + plan qualité d'une
  fonctionnalité).
- **`docs/06-etat-davancement.md`** — journal d'avancement fonctionnel.

Si une session distante apprend un fait durable (piège, décision, état de
prod), l'écrire dans `.claude/memory/` et l'indexer dans `MEMORY.md` : c'est
la seule voie pour qu'il revienne sur le poste principal. **L'entrée d'index
fait 2 lignes maximum** — le journal détaillé vit dans la fiche, jamais dans
l'index, qui est lu à chaque début de session.

⚠️ **Ce qui n'est jamais versionné ici.** Ce dépôt est **public**. Les fiches
de mémoire décrivant l'accès au serveur ou la posture de sécurité — politique
`sudo`, chemins de configuration système, autres services hébergés sur la
machine, identifiants sous quelque forme que ce soit — restent **hors du
dépôt**, sur le poste principal uniquement. Le miroir `.claude/memory/` est
donc volontairement **incomplet** : ne pas chercher à le « resynchroniser »
intégralement depuis une source locale. Une session distante ne peut de toute
façon pas joindre le serveur, ces détails ne lui servent à rien.

## Ce qui n'est PAS faisable hors du réseau local

- **Déploiement et vérification prod** : le serveur n'est joignable qu'en LAN
  (`ssh edouard@<ip-lan>`), et les clés sops+age vivent sur le serveur. Aucun
  `deploy.mjs`, aucun rejeu de projection depuis une session distante.
- **Stack Docker locale** : seed, `e2e-stack` et `web:e2e-visuel` supposent la
  pile compose locale. Les vérifications visuelles se font sur le poste ou en CI.

Une session distante produit donc du **code et des PR** ; les releases et les
vérifications live attendent un accès au poste principal.

# Boucle d'amélioration — où atterrit ce qu'on apprend

Un lot produit toujours trois choses en plus de son code : des **pistes** qu'on ne traite pas
maintenant, des **leçons** sur ce qui nous a trompés, et des **empêchements** — ce que l'atelier
nous a interdit de faire aussi bien que le lot le demandait. Elles ont longtemps été écrites en
prose dans `MEMORY.md`, ou dans la prose d'une PR : lisibles, mais impossibles à trier, à compter
et à clore — au point qu'un même motif y a été relevé huit fois sans jamais devenir une garde.

Elles vont désormais dans **[`docs/34-registre-ameliorations.md`](docs/34-registre-ameliorations.md)** :

- une **piste** (`AM-xx`) — quelque chose à faire, avec son **critère de sortie** ;
- un **empêchement** (`EM-xx`) — une friction d'**atelier** qui a changé le livrable, avec son
  remède ou son renoncement daté. `EM` ou `AM` se tranche sur le remède : s'il change le produit,
  c'est `AM` ; s'il change l'atelier, c'est `EM` (filtre complet en doc 34 §1.5) ;
- une **leçon** (`LE-xx`) — pourquoi on s'est trompé, avec sa **prévention** ;
- un **motif** (`MO-x`) — l'agrégat des leçons qui se répètent. **À la troisième récurrence, on
  n'écrit plus une leçon : on écrit une porte** ;
- un **défaut produit** ne va pas là : il va en `AN-xx` ([doc 22](docs/22-registre-anomalies.md)).

Trois gestes, dans cet ordre :

1. **Au moment du constat** — `/consigner <le constat>`. Une phrase suffit ; la commande numérote,
   remplit les colonnes et rattache le motif.
2. **Avant d'exécuter un lot** — commencer par un **constat négatif** : vérifier l'énoncé contre le
   code réel, et regarder la **sortie** de l'outil censé garder le sujet, pas seulement son code.
   C'est ce geste, et lui seul, qui a trouvé les défauts les plus coûteux de ce dépôt.
3. **À l'ouverture de la PR** — déclarer les identifiants consignés (cases du gabarit), puis
   `pnpm registre` et `pnpm empechements` (les portes tournent sans `node_modules`). C'est le
   dernier moment où un **empêchement** peut encore être écrit : la session qui l'a subi ne
   survit pas au merge de sa propre PR.

Le §5 du registre est la carte des **portes** du dépôt, avec deux colonnes qu'aucune autre doc ne
porte : **ce que la porte ne couvre pas**, et **sa sonde négative**. Toute porte ajoutée au dépôt
s'y inscrit, avec sa sonde — le nombre de portes sans sonde ne peut que baisser.

Le §6 en est le négatif : la file des **empêchements**. La liste « Encore réels » de
`CONTRIBUTING.md` y est adossée piège par piège (porte `pnpm empechements`, attendu dérivé du
fichier) : elle ne peut plus s'allonger sans qu'un remède entre en file, ou sans qu'un
renoncement soit daté et signé.
