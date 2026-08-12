---
description: Exécuter un lot de plan selon le rituel du dépôt — lecture du plan, préflight, constat négatif d'abord, portes CI, PR, mise à jour mémoire
argument-hint: <plan> <lot> — ex. « consolidation-ui-et-qualite C8 »
---

# Exécuter le lot : $ARGUMENTS

Suivre ce rituel dans l'ordre. Il encode les leçons payées par les lots précédents ; aucune
étape n'est décorative.

## 1. Lire avant d'agir

- La fiche mémoire du chantier (via `.claude/memory/MEMORY.md`) et le plan dans
  `.claude/plans/` : le plan est la source de vérité du découpage en lots.
- CONTRIBUTING.md § « Pièges : ce que l'outillage garantit » — pour distinguer les pièges
  morts (encodés dans l'outillage) de ceux encore réels.
- ⚠️ **Vérifier l'énoncé du lot contre le code réel avant d'implémenter.** Plusieurs lots
  (C5, C7, D3…) avaient un énoncé périmé ou se trompant d'endroit : la reconnaissance
  précède l'exécution, et un écart constaté se documente dans la PR comme « écart assumé ».

## 2. Préparer l'environnement

- `corepack pnpm@10.34.2 preflight` — corriger toute erreur avant de coder.

## 3. Constater en négatif d'abord

- Avant de corriger un défaut, **prouver qu'il existe** : reproduire l'échec, mesurer
  l'absence (ex. D8 : `find … coverage-summary.json` ⇒ zéro fichier, donc « pas mesuré »,
  pas « 100 % »). Un correctif sans constat négatif préalable ne prouve rien.
- **Se méfier du périmètre de l'outil, pas seulement du code** : le mode de défaillance
  dominant du dépôt (7 récurrences : D2, C5, D4, B7, D6, extension 08/2026, D8) est un
  outil vert parce qu'il ne regarde pas. Avant de conclure « c'est propre », vérifier ce
  que l'outil regarde vraiment.
- Toute porte de CI créée ou modifiée embarque une **sonde négative** qui prouve qu'elle
  voit son périmètre entier — et c'est le moment où l'on regarde vraiment sa sortie.

## 4. Implémenter

- Conventions : CONVENTIONS.md (dont §4 frontières Nx et miroirs de vocabulaire),
  primitives et patterns existants plutôt que réinventés, **dérivation plutôt que miroir**
  (un miroir inévitable s'inscrit au registre `MIROIRS`).
- Rester dans le périmètre du lot ; ce qui déborde va dans la PR suivante ou dans le plan.

## 5. Prouver avant de pousser

- `corepack pnpm@10.34.2 nx affected -t lint typecheck test build --base=main`
- `corepack pnpm@10.34.2 frontieres`, `corepack pnpm@10.34.2 pieges` et
  `corepack pnpm@10.34.2 registre` (steps bloquants du job `ci`, < 1 s chacun).
- Ratchet ESLint : la baseline (`.github/workflows/lint-baseline.json`) ne monte jamais ;
  signaler les règles tombées à zéro (promotion gratuite en `error`).
- Si du CSS ou des composants web sont touchés : prouver l'iso-rendu avec
  `nx run web:e2e-visuel` puis `node scripts/comparer-empreinte.mjs avant.json apres.json`.
- Format : juger sur `git diff`, jamais sur `prettier --check` local (piège CRLF).

## 6. Livrer

- Une PR par lot, commit conventionnel (sujet ≤ 100 caractères, commitlint).
- La description de PR reprend l'énoncé du lot, les **écarts assumés** par rapport au plan,
  et les preuves (commandes jouées, chiffres avant/après).

## 7. Capitaliser

- **Pistes et leçons** trouvées en cours de lot → `/consigner` (registre doc 34, `AM-xx`/
  `LE-xx`/motifs) — plus jamais en prose dans `MEMORY.md` ; déclarer les identifiants
  consignés dans la PR.
- **Empêchements d'outillage** subis pendant le lot → `/consigner` également, famille
  `EM-xx` (doc 34 §6). Le filtre est en doc 34 §1.5 — trois conditions cumulatives : le
  constat a **changé le livrable**, il **se reproduira**, un **remède est concevable**.
  Le moment de consigner est **l'ouverture de la PR, pas le merge** : une session ne
  survit pas au merge de sa propre PR, alors que l'empêchement est entièrement connu à
  l'instant où on le subit. Écrire ce qu'il a **coûté au lot**, pas seulement ce qui
  manque : « les sondes prouvent le SQL, jamais qu'une ligne survit » se traite, « il
  n'y a pas de harnais » se contemple.
- Faits durables d'un chantier (décision, état de prod, piège daté) → fiche du chantier
  dans `.claude/memory/`, et entrée d'index **≤ 2 lignes** dans `MEMORY.md` (le journal
  détaillé vit dans la fiche, jamais dans l'index).
- Avancement fonctionnel → `docs/06-etat-davancement.md` si applicable.
