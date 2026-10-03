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

# Martha — ce qu'il faut savoir avant d'écrire une ligne

Produit affiché **« Martha »**, identité technique **`creche-planner`** — l'écart est assumé
([ADR-0009](docs/adr/0009-nom-du-produit-martha.md)). Le dépôt est **public**. Tout ce qui suit
renvoie aux documents qui font foi : ce fichier ne les remplace pas, il dit où regarder.

## Architecture

- **Microservices stricts** ([ADR-0001](docs/adr/0001-architecture-microservices.md)), hexagonaux à
  l'intérieur : `svc-foyer` · `svc-referentiel` · `svc-planification` · `svc-tarification` ·
  `svc-notifications` (NestJS, une base PostgreSQL chacun), derrière `api-gateway` (BFF NestJS,
  sans base) ; `web` (React).
- **Par contexte** : `libs/<contexte>/domain` (TypeScript pur, sans framework) et
  `libs/contracts/<contexte>` (contrats décentralisés,
  [ADR-0004](docs/adr/0004-decentralisation-des-contrats.md)). Partagé : `shared-kernel`,
  `shared-semaine`, `nest-commons`, `observability`, `resilience`.
- Frontières tenues par les tags Nx `type:*` × `context:*` et la porte `pnpm frontieres`
  ([CONVENTIONS.md](CONVENTIONS.md) §4).
- Entre services : REST pour le synchrone, **événements NATS JetStream via outbox** pour le reste ;
  contrats Pact en fichiers et garde `can-i-deploy` ([ADR-0005](docs/adr/0005-registre-de-contrats.md)).
  Détail : [doc 04](docs/04-architecture-et-technos.md), [doc 09](docs/09-spec-decouplage-microservices.md).

## Ce qui fait foi

- **Les ADR** ([`docs/adr/`](docs/adr/), index dans [docs/README.md](docs/README.md)) : une
  décision structurante s'écrit en ADR avant le code ([doc 03](docs/03-standards-developpement.md)
  §10). Avant de toucher aux données personnelles, lire
  [ADR-0007](docs/adr/0007-exemption-domestique-et-demarche-volontaire.md) ; à la sémantique HTTP,
  [ADR-0008](docs/adr/0008-ecarts-semantique-http-pagination-et-concurrence.md).
- **Les SFD numérotées** pour le fonctionnel, le **plan** (`.claude/plans/`) pour le découpage en
  lots, le **registre** ([doc 34](docs/34-registre-ameliorations.md)) pour les pistes et leçons.
- Un document = un quadrant, un statut daté ([doc 35](docs/35-politique-documentation.md)).

## Portes de qualité

- Avant de pousser : `pnpm check`. Les portes `pnpm <nom>` (`scripts/verifier-*.mjs`) tournent
  sans `node_modules`, en moins d'une seconde : les jouer en local plutôt qu'attendre la CI. Leur
  liste est dans le tableau _Gates_ du [README](README.md) ; ce que chacune **ne couvre pas** et sa
  **sonde négative**, dans la [doc 34](docs/34-registre-ameliorations.md) §5.

<!-- FAITS:controles-requis -->

- Contrôles **requis** par la protection de `main` — 5 au
  2026-10-03 : `ci`, `config-validation`, `texte-pr`, `lint-ratchet`, `mutation-delta`.
  Protection : branche à jour exigée avant fusion, aucune revue requise, administrateurs NON soumis à la protection.
  Cette liste est **engendrée** (`pnpm controles --ecrire`) depuis le relevé
  `scripts/controles-requis.json` : ne pas la rédiger à la main.

<!-- /FAITS:controles-requis -->

- Les autres contrôles (`security`, `pact-drift`, `e2e-stack`…) bloquent autant en pratique :
  un rouge se lit et se traite, il ne s'attend pas.
- Tests : couverture qui ne baisse pas de plus de 0,5 pt ; mutation Stryker sur les quatre libs
  de domaine, seuil 80 % ([TESTING.md](TESTING.md)) ; avertissements ESLint gelés par un ratchet.
- **Ne jamais contourner une porte** (`--no-verify`, exception ajoutée « pour passer », seuil
  baissé). Si une porte gêne, c'est le changement qui s'adapte ; une exception est une décision du
  propriétaire, écrite dans la porte avec sa raison.

## Conventions

- [CONVENTIONS.md](CONVENTIONS.md) (TypeScript strict, React Compiler, frontières, types
  marqués) et [CONTRIBUTING.md](CONTRIBUTING.md) (boucle de dev, pièges encore réels).
- Code, commentaires, docs et commits **en français** ; `README.md` et `TESTING.md` sont en
  anglais (vitrine, compagnons des sources françaises qui font foi).
- Commits : Conventional Commits, en-tête ≤ 100 caractères, sujet **sans majuscule initiale**
  (commitlint le refuse). Le numéro d'une ligne du registre est le **premier libre** : la porte
  `pnpm registre` refuse les trous.
- Une session = un worktree (`git worktree add`), index construit par **chemins explicites**
  (jamais `git add -A`) : un arbre partagé a déjà emporté le travail d'une autre session.

## Pièges connus

- **Windows et fins de ligne** : `prettier --check` et `pnpm liens` sont rouges en local sur des
  fichiers intacts (`EM-07`, `EM-03`, CRLF sur disque). Vérité de format :
  `pnpm nx format:check --base=origin/main --head=HEAD` ; pour les liens, seules comptent les
  erreurs sur les fichiers du diff. La CI (checkout LF) juge l'ensemble.
- **`security` rouge sur une PR qui ne touche aucune dépendance** : Trivy scanne le lockfile de la
  branche, et une CVE publiée entre-temps rougit toutes les PR. Lire le journal (lignes `Total:`),
  corriger par une montée sur `main`, puis rebaser — pas dans la PR, et jamais en assouplissant.
- **pnpm** : toujours `corepack pnpm@10.34.2`, jamais le pnpm global (une autre majeure réécrit le
  lockfile dans un format que la CI refuse). `pnpm preflight` en début de session.
- **`/pacts` reste dans `.prettierignore`** (`EM-05`) ; une migration drizzle `drop`/`rename` se
  tranche dans un prompt TTY invisible pour un agent (`EM-06`) : procédure en deux passes.
- Refonte CSS/web : prouver l'iso-rendu avec `nx run web:e2e-visuel`, puis
  `node scripts/comparer-empreinte.mjs avant.json apres.json` (poste ou CI, pile locale requise).

# Contexte projet pour les sessions distantes

Ce dépôt embarque son propre contexte de travail, pour qu'une session lancée
ailleurs que sur le poste de l'auteur (Claude Code sur le web, autre machine)
reparte avec le même historique de décisions.

- **`.claude/plans/`** — plans de chantier détaillés (lots, décisions, critères
  d'acceptation). Le plan est la source de vérité du découpage en lots.
- **`.claude/commands/`** — commandes slash du projet : `/executer-lot` (le
  rituel d'exécution d'un lot de plan), `/recherche-pistes` (cartographie des
  pistes d'amélioration), `/upgrade-qualite-mobile` (audit + plan qualité d'une
  fonctionnalité).
- **`docs/06-etat-davancement.md`** — journal d'avancement fonctionnel.

⚠️ **La mémoire de travail n'est jamais versionnée ici.** Ce dépôt est
**public**. `.claude/memory/` (fiches de chantier, pièges, faits de prod) vit
**sur le poste principal uniquement** : il est dans `.gitignore`, et la porte
`pnpm confidentialite` (CI + pre-commit) refuse tout fichier suivi sous ce
chemin, `git add -f` compris. Il a été versionné du 2026-08-02 au 2026-09-29
et a publié l'accès au serveur de production : la règle précédente, qui ne
proscrivait que certaines **fiches**, s'est révélée intenable sans outil.

Si une session distante apprend un fait durable (piège, décision, état de
prod), il passe par ce qui est versionné et relu : une ligne du **registre**
(`/consigner`, doc 34) ou la **description de la PR**. Jamais d'identifiant,
de cible SSH, de chemin système ni de posture de sécurité, sous aucune forme :
une session distante ne peut pas joindre le serveur, ces détails ne lui
servent à rien.

## Ce qui ne va jamais dans ce dépôt

Cette section **ne fait pas foi** : une consigne en prose est précisément ce qui
a échoué ici. La liste qui fait foi est **la porte** —
`scripts/verifier-confidentialite.mjs`, ses règles, ses exceptions motivées —,
jouée en pre-commit, en `commit-msg` et dans le job `ci` (fichiers, messages de
commit, titre et description de PR). En substance : la mémoire de travail ;
une cible SSH, une IP ou un nom de machine du serveur ; une adresse e-mail hors
domaine réservé (`example.com`, `*.example`, `*.test`, `*.invalid`) ; un
chemin qui nomme un compte ; et toute donnée d'une **personne réelle** —
enfant, parent, personnel de la crèche. Les valeurs réelles à proscrire vivent
dans une **liste privée hors dépôt** (`~/.config/creche-planner/motifs-interdits.txt`,
secret CI `CRECHE_MOTIFS_INTERDITS`), jamais ici, même hachées.

**Si la porte refuse : retirer la valeur, ne jamais contourner** (`--no-verify`,
exception ajoutée « pour passer »). Une exception nouvelle est une décision du
propriétaire, écrite dans la porte avec sa raison. Une fixture s'écrit avec des
valeurs **manifestement fictives** — et on n'écrit pas de test de masquage avec
une vraie valeur.

## Ce qui n'est PAS faisable hors du réseau local

- **Déploiement et vérification prod** : le serveur n'est joignable qu'en LAN
  (`ssh <utilisateur>@<ip-lan>`), et les clés sops+age vivent sur le serveur. Aucun
  `deploy.mjs`, aucun rejeu de projection depuis une session distante.
- **Stack Docker locale** : seed, `e2e-stack` et `web:e2e-visuel` supposent la
  pile compose locale. Les vérifications visuelles se font sur le poste ou en CI.

Une session distante produit donc du **code et des PR** ; les releases et les
vérifications live attendent un accès au poste principal.

# Boucle d'amélioration — où atterrit ce qu'on apprend

Ce qu'un lot apprend va dans le **registre** ([doc 34](docs/34-registre-ameliorations.md)), jamais
en prose dans une mémoire : une **piste** `AM-xx` (avec son critère de sortie), un **empêchement**
d'atelier `EM-xx` (avec son remède ou un renoncement daté), une **leçon** `LE-xx` (avec sa
prévention), un **motif** `MO-x` quand une leçon se répète — à la troisième récurrence, on écrit
une **porte**, pas une leçon. Un défaut produit va en `AN-xx` ([doc 22](docs/22-registre-anomalies.md)).

1. **Au moment du constat** — `/consigner <le constat>` : une phrase, la commande fait le reste.
2. **Avant d'exécuter un lot** — un **constat négatif** : vérifier l'énoncé contre le code réel, et
   lire la **sortie** de l'outil censé garder le sujet, pas seulement son code.
3. **À l'ouverture de la PR** — déclarer les identifiants consignés, puis `pnpm registre` et
   `pnpm empechements`. C'est le dernier moment pour écrire un empêchement : la session qui l'a
   subi ne survit pas au merge de sa PR.
