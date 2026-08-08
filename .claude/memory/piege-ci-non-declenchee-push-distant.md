---
name: piege-ci-non-declenchee-push-distant
description: 'Un push depuis une session distante ne déclenche pas de run CI ; fermer/rouvrir la PR le fait'
metadata:
  node_type: memory
  type: project
---

**Observation, 2026-08-08 (PR #295, session distante Claude Code sur le web).** Trois
`git push` successifs sur la branche d'une PR ouverte n'ont produit **aucun** run de
workflow : `get_status` restait `pending` avec `total_count: 0`, indéfiniment (vérifié
25 min après le second push). Seul le **premier** run avait tourné — celui déclenché par
l'événement `opened` à la création de la PR.

**Ce qui débloque** : fermer puis rouvrir la PR. `reopened` fait partie des types
d'événements `pull_request` par défaut, donc la CI repart immédiatement sur le SHA
courant. Effets de bord à connaître : la fermeture désabonne la session des événements
de la PR (elle se réabonne à la réouverture), et une éventuelle auto-fusion ou place en
file d'attente ne survit **pas** à la fermeture.

**Ce qui ne marche pas** :

- attendre — ce n'est pas de la latence, le run n'est jamais créé ;
- passer la PR de brouillon à « prête » : `ready_for_review` **n'est pas** un type
  déclencheur par défaut ;
- `workflow_dispatch` : `ci.yml` ne le déclare pas (`on: push` sur `main` +
  `pull_request` seulement).

**Cause probable, non vérifiée** : GitHub ne crée pas de run pour un événement produit
par un jeton d'application, afin d'éviter les boucles de workflows. L'observation, elle,
est certaine ; la cause reste une hypothèse — ne pas la citer comme un fait.

**Conséquence pratique** : depuis une session distante, prévoir que **le dernier push
avant la fusion demande une fermeture/réouverture** pour que le check `ci` requis par la
protection de branche existe. Sans lui, la PR reste non fusionnable, sans rien de rouge
à corriger — l'échec est _silencieux_, ce qui est le vrai piège.
