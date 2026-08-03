---
name: veille-alertes-outillage
description: "Comment vérifier les alertes CodeQL/Dependabot depuis une session distante — passer par le workflow `veille-alertes.yml`, jamais par l'API directe (403)"
metadata:
  node_type: memory
  type: reference
---

**Le point mort (issue #279).** Depuis une session distante (Claude Code sur le web),
les alertes de sécurité sont **illisibles** :

- aucun outil MCP GitHub n'expose `code-scanning/alerts` ni `dependabot/alerts` ;
- l'appel direct à l'API répond `403 — GitHub access is not enabled for this session.`
  (blocage du proxy, y compris avec le jeton du run).

Conséquence : une veille distante ne peut **pas** conclure « aucune alerte ». Le
verdict ORANGE du 2026-08-03 venait de là — pas d'un problème réel, d'une cécité.

**L'outillage (workflow `veille-alertes.yml`).** La lecture est déplacée là où le
jeton a le droit de lire : un job Actions du dépôt. Cron quotidien 05:40 UTC +
`workflow_dispatch`. Logique dans `.github/workflows/scripts/veille-alertes.mjs`
(Node pur, zéro dépendance, testable en `ALERTES_DRY_RUN=1`).

**Comment lire le résultat depuis une session distante.** Lister les runs du
workflow — ça, une session distante SAIT le faire — et lire la conclusion :

| Conclusion | Signification                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `success`  | Les deux endpoints ont **répondu 200** ET aucune alerte ouverte ≥ `critical/high`. Vert **opposable**.                  |
| `failure`  | Soit `POINT MORT` (vérification impossible), soit `ALERTES` (findings réels). **Le résumé du run dit toujours lequel.** |

Ne jamais s'arrêter à « c'est rouge » : ouvrir le `GITHUB_STEP_SUMMARY`, les deux
causes appellent des suites opposées.

**Règle cardinale, encodée dans le script.** Un appel qui échoue n'est JAMAIS lu
comme « aucune alerte ». `lireAlertes()` renvoie un état `ok:false` distinct que
l'appelant est obligé de traiter — pas une liste vide. Un `catch` qui renverrait
`[]` transformerait un point mort en feu vert.

**Piège corrigé à l'écriture, à ne pas réintroduire.** Sur cron,
`github.event.inputs.seuil` vaut la chaîne **vide**, pas `undefined`. Écrire
`process.env.ALERTES_SEUIL ?? 'critical,high'` donne alors un seuil `[]` → plus
aucune alerte n'est « au-dessus du seuil » → **faux vert permanent**. Il faut `||`.

**Si `dependabot/alerts` répond 403 en CI.** La couverture du `GITHUB_TOKEN` par
défaut sur cet endpoint dépend de la configuration du dépôt. Le run part au rouge
avec la marche à suivre : poser un secret Actions `ALERTS_TOKEN` (PAT, scope
`security_events`), que le script préfère au jeton par défaut. **Ne pas** « régler »
le problème en rendant l'erreur silencieuse.

**Divergence assumée avec `image-scan.yml`.** La veille CVE des images est non
bloquante (findings ⇒ vert + e-mail). Ici les findings passent au **rouge**, parce
que ce workflow n'existe que pour produire un vert digne de confiance : un vert
pouvant signifier « alertes critiques mais rien bloqué » ne vaudrait rien. Aucun
build ne dépend de ce workflow, il n'est pas un check requis.
