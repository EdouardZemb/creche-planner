---
name: piege-codeql-action-init-analyze-desync
description: "Le check « Analyse CodeQL » rouge sur une PR Dependabot n'est ni un bug CodeQL ni une vraie alerte — c'est `init` et `analyze` désynchronisés par deux PR séparées"
metadata:
  node_type: memory
  type: reference
---

`github/codeql-action/init` et `github/codeql-action/analyze` sont deux **sous-actions du même
dépôt**, utilisées dans le **même job** de `.github/workflows/codeql.yml`. `analyze` relit le
fichier de configuration écrit par `init` et **refuse** un fichier produit par une autre version :

```
##[warning]Not all workflow steps that use `github/codeql-action` actions use the same version.
##[error]Loaded a configuration file for version '4.37.0', but running version '4.37.4'
##[error]analyze post-action step failed
CodeQL job status was configuration error.
```

Le job se termine en **`configuration error`**, pas en « vulnérabilité trouvée ». Il uploade quand
même un SARIF d'échec (« Successfully uploaded a SARIF file for the unsuccessful execution »), ce
qui rend le rouge **trompeur dans l'onglet Security** : on croit à une alerte, c'est un problème de
version.

**Cause racine (2026-08-02).** L'écosystème `github-actions` de `.github/dependabot.yml` n'avait
aucun `groups`. Dependabot ouvre donc **une PR par sous-action** — #269 (`analyze` 4.37.0→4.37.4)
et #270 (`init` 4.37.0→4.37.4). Chaque PR ne bouge **qu'une moitié** du couple, et casse le check
« Analyse CodeQL (javascript-typescript) » sur sa propre branche. Les deux PR visaient pourtant le
**même SHA cible** (`f205ea1c…`) : ni l'une ni l'autre n'était fautive, c'est le découpage qui l'était.

**Correctif.** Groupe `codeql-action` (`patterns: ['github/codeql-action*']`) dans
`.github/dependabot.yml` → les deux sous-actions montent désormais dans **une seule PR**, donc
toujours en phase.

**Méthode de diagnostic.** Devant un check CodeQL rouge sur une branche de bump : lire le log du job
et chercher `Loaded a configuration file for version`. Si présent, c'est ce piège — ne pas chercher
une régression de sécurité, ne pas relancer le workflow (il rougira à l'identique), aligner les
lignes `init` et `analyze` sur le même SHA. Un run vert sur `main` juste après ces échecs est
normal : `main` a les deux moitiés en phase.

**Ne pas généraliser à tout `github-actions`.** Le groupe est volontairement restreint au couple
CodeQL. Les autres actions (`checkout`, `setup-node`, `login-action`…) sont indépendantes et gagnent
à rester en PR séparées, où une majeure comme `setup-node` v7 reste relisible isolément.
