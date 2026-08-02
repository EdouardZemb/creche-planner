---
name: piege-prettier-check-crlf
description: 'En local Windows, `prettier --check` signale TOUS les .md/.json comme non conformes — artefact CRLF, pas une vraie dérive de format'
metadata:
  node_type: memory
  type: reference
  originSessionId: c21859ec-2bdc-407c-b6e5-1a897fd90f56
  modified: 2026-08-02T06:55:43.937Z
---

`corepack pnpm@10.34.2 exec prettier --check <fichier.md>` échoue en local sur **n'importe quel**
fichier suivi, y compris intact sur `main`. Ce n'est pas une dérive de format : `core.autocrlf=true`
matérialise la copie de travail en CRLF, alors que prettier écrit en LF (`endOfLine: "lf"` par défaut).
`diff` montre alors `1,2211c1,2211` — _toutes_ les lignes changées, ce qui ressemble à un reformatage
massif et n'en est pas un.

**Ne pas** lancer `prettier --write` en croyant réparer quelque chose. Le diff de fin de ligne est
**invisible à git** (l'index est normalisé LF) : `git diff --stat` ne montre que le vrai changement.
Le hook lint-staged fait le `--write` au commit sans bruit, et la CI vérifie sur un checkout Linux (LF)
où le problème n'existe pas.

**Méthode** : juger la conformité sur `git diff`, jamais sur `prettier --check` local. Pour vérifier
qu'une rédaction est bien conforme, lancer `prettier --write` puis `git diff --stat` — si le décompte
de lignes correspond au seul texte ajouté, c'est bon.

**Exception : une seule passe de `--write` ne suffit pas toujours.** Sur un `.md` où un **code span
inline se poursuit sur la ligne suivante** à l'intérieur d'un item de liste, prettier réindente la
ligne de continuation (4 → 2 espaces) — or cette ligne est _dans_ les backticks, donc le contenu du
span change et une **seconde passe** est nécessaire pour converger. lint-staged n'en fait qu'**une** :
le commit part avec un fichier encore non conforme et `nx format:check` casse la CI. Vu sur
`.claude/plans/qualite-couts.md` ([PR #276](https://github.com/EdouardZemb/creche-planner/pull/276)).
Symptôme caractéristique : `prettier --check` refuse un fichier que le hook vient de formater.
Remède : relancer `prettier --write` jusqu'à ce que `--check` passe (2 passes suffisent).

**Corollaire de méthode** : ne pas « balayer » un doute de format sur des copies extraites
(`git show`, `git archive`) — sur Windows la conversion CRLF s'applique à l'extraction et fait
ressortir des dizaines de faux positifs. Rester sur `git diff` dans l'arbre de travail, qui est
normalisé LF, ou croire la CI. (Piège vérifié : 20 fichiers « sales » annoncés, 1 seul vrai.)

`.gitattributes` fige `eol=lf` uniquement là où les octets comptent (`/pacts/**`, `*.gen.ts`, `*.sh`,
unités systemd, `.env.server.enc`) — voir [[code-conventions-strict]] et
[[piege-pact-drift-flaky-course-pact-core]].
