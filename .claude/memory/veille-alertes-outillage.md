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

**`GITHUB_STEP_SUMMARY` est un sink Markdown, pas un log.** GitHub _rend_ ce
fichier : y écrire tel quel un nom de paquet npm ou un résumé d'advisory (données
de l'écosystème public) permet d'injecter un lien, une image ou de casser la
structure du rapport. CodeQL l'a signalé sur la 1re version (« Network data written
to file », PR #281). Toute valeur venue de l'API passe donc par `assainir()`
(caractères de contrôle retirés, Markdown/HTML échappé, longueur bornée), les
sévérités par une **liste fermée** (`normaliserSeverite()`), et les `html_url` par
`lienGitHub()` qui refuse tout ce qui n'est pas `https://github.com/…`. Le jeu
d'essai `ALERTES_DRY_RUN=1` est volontairement **hostile** et sert de test de
non-régression — il sort en `exit=1` (chemin ALERTES), c'est normal.

Ce jeu d'essai est **exécuté en CI** par le job `veille-alertes-autotest` de
`ci.yml`, gaté sur `config-changes` (qui filtre déjà `.github/workflows/**`) : il
est donc skippé, et traité comme réussi par la protection de branche, sur les PR
qui n'y touchent pas. Il vérifie les deux contrats — chemin ALERTES (code 1, charge
échappée, lien refusé, une seule ligne) et chemin POINT MORT (code 1 + mention
explicite). Garde-fou validé par test négatif : en neutralisant `assainir()`, le job
échoue bien. **Ne pas** le transformer en step de `config-validation` (qui monte la
pile d'observabilité ≈15 min) : le signal doit rester rapide et lisible.

⚠️ **L'alerte CodeQL reste ouverte, et c'est assumé.** `js/http-to-file-access` est
une règle brute « donnée réseau → écriture fichier » : l'échappement Markdown n'est
pas un sanitizer qu'elle reconnaît, donc elle re-signale à chaque analyse (1 medium).
Elle décrit une propriété **inhérente au design** — ce workflow existe pour écrire
des données d'alerte distantes dans un rapport. À **dismisser dans l'onglet
Security** (motif : données assainies à l'écriture), pas à « corriger » par une
suppression `// codeql[...]` en dur, qui masquerait aussi une vraie régression.
Sévérité _medium_ : elle ne franchit pas le seuil `critical,high`, donc elle ne fait
pas rougir `veille-alertes.yml`.

**Si `dependabot/alerts` répond 403 en CI — lire le CORPS, deux causes opposées.**

| Corps de la réponse                                   | Cause                                                | Remède                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Dependabot alerts are disabled for this repository.` | fonctionnalité **éteinte** sur le dépôt              | l'activer dans **Settings → Code security → Dependabot alerts**. Aucun jeton n'y changera rien |
| tout autre 403                                        | couverture insuffisante du `GITHUB_TOKEN` par défaut | poser un secret Actions `ALERTS_TOKEN` (PAT, scope `security_events`), préféré par le script   |

⚠️ **C'est le premier cas qui est survenu** (runs des 2026-08-04 et 05). La première
version du message d'aide menait avec le PAT et ne citait l'activation qu'en
seconde ligne : elle envoyait fabriquer un jeton **sans aucun effet** pendant que
la veille restait aveugle. Le script trie désormais sur le corps de la réponse, et
le job `veille-alertes-autotest` verrouille le tri via
`ALERTES_DRY_RUN=dependabot-desactive` (rejoue le 403 réel ; assertions : sortie 1,
« Settings → Code security » présent, `ALERTS_TOKEN` absent).

**Action restante, hors de portée d'une session distante** : activer les alertes
Dependabot dans Settings. Tant que ce n'est pas fait, `veille-alertes.yml` reste
ROUGE en POINT MORT — c'est le comportement voulu, pas une régression à « corriger ».

**Ne pas** « régler » un 403 en rendant l'erreur silencieuse.

**Tri des 5 alertes CodeQL ≥ seuil du 2026-08-05** (run 30987623430). Les détails
d'alerte ne sont **pas** lisibles d'ici (`code-scanning/alerts` → 403, cf. plus
haut) : le tri s'est fait en relisant le code depuis les couples règle/fichier du
résumé. Verdicts, une fois pour toutes :

| Alerte   | Règle                                           | Verdict                                               |
| -------- | ----------------------------------------------- | ----------------------------------------------------- |
| #20, #21 | `js/type-confusion-through-parameter-tampering` | **vrai positif, exploitable** → corrigé               |
| #17      | `js/insecure-temporary-file`                    | vrai, impact faible → corrigé (`mkdtempSync`)         |
| #12, #1  | `js/clear-text-logging`                         | faux positif → **à dismisser** dans l'onglet Security |

**#20/#21 — le seul vrai défaut, et il est silencieux.** `cout.controller.ts`
validait avec `ISO_MOIS.test(mois)`. `RegExp.test` **stringifie** son argument :
Express parse `?mois[]=2026-09` en tableau, et `['2026-09'].toString()` satisfait
la regex. Un tableau traversait donc la garde **typé `string`**, et en aval
`Number(mois.slice(0, 4))` rendait `NaN` — les frais fixes ABCM de première année
n'étaient jamais facturés. Aucune exception, aucun log : juste un montant faux.
Corrigé par `typeof x !== 'string'` en tête des trois gardes + paramètres de requête
typés `unknown` (le `string` déclaré était précisément le mensonge exploité).
Verrouillé par 3 tests. **Portée limitée à la facturation, pas à l'autorisation** :
`ScopeFoyerGuard.couvert()` compare via `Array.includes`, qu'un tableau ne satisfait
jamais → il échoue _fermé_ (403). Réflexe à garder : une regex n'est pas un
validateur de type, elle coerce.

**#12/#1 — faux positif, mais quasi-accident.** Les seuls sinks sont les traces
`$ ${cmd} ${args.join(' ')}` de `run()`/`runCapture()`, et aucun chemin d'appel n'y
fait passer de secret : `sonde()` (`apply-observability.mjs`) construit bien un
`Authorization: Basic <base64(admin:GRAFANA_ADMIN_PWD)>` mais appelle `spawnSync`
**directement**, sans log. Router `sonde()` par `run()` publierait le mot de passe
admin Grafana dans le journal de déploiement — le faux positif est à un refactor
près de devenir vrai. À dismisser, pas à « corriger ».

**Divergence assumée avec `image-scan.yml`.** La veille CVE des images est non
bloquante (findings ⇒ vert + e-mail). Ici les findings passent au **rouge**, parce
que ce workflow n'existe que pour produire un vert digne de confiance : un vert
pouvant signifier « alertes critiques mais rien bloqué » ne vaudrait rien. Aucun
build ne dépend de ce workflow, il n'est pas un check requis.
