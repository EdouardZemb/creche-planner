---
name: piege-numeros-pr-pre-publication
description: "Les numéros de PR antérieurs au 2026-06-18 cités dans les docs sont ceux de l'ancien dépôt privé — invalides sur le dépôt public"
metadata:
  node_type: memory
  type: project
  originSessionId: 8d615960-c04c-4f9b-b073-261fa16b8473
---

Le dépôt public `EdouardZemb/creche-planner` démarre au commit **« chore: import
initial public » `4f36e3e`** (publication du 2026-06-18) : tout l'historique privé a
été squashé. Conséquence : **toute référence de PR antérieure au 2026-06-18** (docs
25/27 : #20, #22, #23, #39→#48…) désigne une PR de l'**ancien dépôt privé** et
résout, sur GitHub, vers une PR publique **sans rapport** (ex. le #40 public est une
PR de roadmap CI/CD). C'est ce qui rendait les tableaux d'audit « contradictoires »
entre deux lectures.

**Why:** éviter de re-conclure à tort qu'une action d'audit n'est pas faite parce que
« la PR liée ne correspond pas » — la preuve du fait est le code, pas le lien.

**How to apply:** ne jamais lier une PR pré-publication ; vérifier un statut d'audit
dans le code/la CI. Les docs 25/27 portent depuis [[gouvernance-doc-2026-07]] (PR
#142) un encart d'avertissement à ce sujet.
