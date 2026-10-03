# ADR-0012 — Rendre la péremption visible : une veille différentielle et des exceptions qui expirent

- **Statut** : Accepté
- **Date** : 2026-10-03
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0003](0003-decisions-de-toolchain.md) (chaîne d'outils et portes
  de qualité). Même famille de défaut qu'une documentation recopiée : une affirmation vraie à
  l'écriture, fausse à la lecture — ici elle se périme toute seule.
- **Numérotation** : `0012` et non `0011` — le numéro `0011` est pris par une PR sœur du même
  jour, et un numéro d'ADR ne se réattribue jamais. Si cette PR-sœur n'est pas retenue, le
  trou reste.
- **Déclencheur** : le 2026-10-03, un audit conclut « `main` est verte » à 15h00 ; à 17h28,
  la même branche au même commit échoue la porte `security` — la base de vulnérabilités de
  Trivy avait avancé entre-temps.

## Contexte

Ce dépôt sait déjà interdire la **recopie** d'un fait (`pnpm faits`, `pnpm readme`). Il ne
sait pas encore gérer les faits qui se périment **tout seuls**, sans que personne ne touche
à rien :

1. un verdict de CI qui change d'un jour à l'autre à commit constant, parce que la vérité
   qu'il consulte vit hors du dépôt ;
2. une exception de sécurité posée « pour un temps » et jamais relue — le bloc `util-linux`
   de `.trivyignore` porte une « DATE DE REVUE : 2026-10-05 » écrite en prose, que rien
   n'applique ; une entrée `brace-expansion` est restée en place après la publication du
   correctif qu'elle attendait.

Les deux veilles existantes ne comblent ni l'un ni l'autre. `veille-alertes.yml` répond
« il y a N alertes ouvertes », `image-scan.yml` « voici les CVE des images en ligne ».
L'information qui manquait le matin du 2026-10-03 n'est ni l'une ni l'autre : c'est la
**différence**.

## Décision

### (a) Une veille différentielle, sans état stocké

[`veille-regression.yml`](../../.github/workflows/veille-regression.yml) tourne chaque jour
et répond à une seule question : **qu'est-ce qui a changé de verdict sans que le dépôt
change ?**

Elle n'étend pas `veille-alertes.yml` — l'objet est différent (une différence, pas un
inventaire) et le mélanger brouillerait le contrat « un vert digne de confiance » de cette
veille-là. Elle en reprend en revanche le **contrat de lecture** mot pour mot : un run rouge
distingue toujours `RÉGRESSION` de `POINT MORT`, et un appel qui échoue n'est jamais lu
comme « rien à signaler ».

**Aucun instantané n'est rangé d'un jour sur l'autre**, et c'est le point de conception.
Un cliché mis en cache serait une affirmation de plus, susceptible de périmer — exactement
le défaut qu'on traite. GitHub conserve déjà tous les check runs d'un même commit, datés :
sur un seul sha, une conclusion `success` suivie plus tard d'un `failure` **est** la
régression cherchée, et elle ne peut pas venir d'un diff puisqu'il n'y en a pas.

Limite connue, et son rattrapage : si rien ne re-joue un contrôle, aucune conclusion
nouvelle n'apparaît et la régression reste invisible. Pour la porte dont la vérité vit hors
du dépôt — l'analyse SCA du lockfile par Trivy — le workflow la **rejoue lui-même** chaque
jour, aux réglages de `ci.yml`, et compare son verdict à la conclusion du dernier `security`
sur le même sha. C'est ce rejeu qui aurait rendu lisible l'épisode de 17h28, le matin même.

Le workflow est **non bloquant** : rien n'en dépend, il n'est pas un contrôle requis. Il
rougit pour être vu.

### (b) Des exceptions de sécurité qui expirent, dans la syntaxe de Trivy

`.trivyignore` adopte la forme `IDENTIFIANT exp:AAAA-MM-JJ`, et
[`pnpm exceptions`](../../scripts/verifier-exceptions-securite.mjs) — step bloquant du job
`ci` — échoue sur une entrée **sans date, à date illisible, périmée, ou sans justification
écrite au-dessus d'elle**, et avertit à J-14.

Le choix du format a été **vérifié, pas supposé**. La documentation Trivy donne deux voies :

| Voie                | Expiration    | Chargement                                       | Verdict                                        |
| ------------------- | ------------- | ------------------------------------------------ | ---------------------------------------------- |
| `.trivyignore`      | `exp:AAAA-MM-JJ` | automatique, par toutes les invocations du dépôt | **retenue**                                    |
| `.trivyignore.yaml` | `expired_at`  | **EXPERIMENTAL**, exige `--ignorefile` explicite  | écartée : surface instable, et un drapeau à poser dans quatre workflows |

La voie retenue a une propriété que la porte seule n'aurait pas : la date **agit deux
fois**. Trivy cesse de supprimer la CVE une fois l'échéance passée — l'exception s'éteint
d'elle-même — et la porte rougit avant, pour que l'échéance se voie venir au lieu de tomber
un matin sans explication.

Les dates manquantes ont été posées par la PR qui crée la porte, et le disent :
`GHSA-qwww-vcr4-c8h2` au 2026-12-31 (horizon de la migration react-router v8), le bloc
`util-linux` au **2026-10-05** — la date que le fichier s'était lui-même fixée en prose.

## Conséquences

**Acceptées.**

- ⚠️ **Au 2026-10-05, les sept entrées `util-linux` expirent.** La porte `pnpm exceptions`
  est un step de `ci`, donc d'un contrôle **requis** : à partir de cette date, toute PR est
  bloquée tant que ces lignes ne sont pas retirées (si `AM-120` est livrée) ou redatées avec
  leur raison. C'est le comportement voulu — une échéance qui ne bloque rien n'est pas une
  échéance — mais il est brutal à deux jours. Le remède est une édition d'une ligne.
- La veille différentielle ne voit que ce qui a été **re-joué**. Hors du rejeu SCA, un
  contrôle jamais relancé ne produit pas de signal.
- Elle ne juge pas la CAUSE : elle affirme seulement que la cause est hors du dépôt, et
  nomme le contrôle.
- `pnpm exceptions` ne juge pas si une raison est bonne, seulement qu'elle est écrite et
  datée. Elle ne lit que `.trivyignore` : une suppression par VEX ou par politique Rego lui
  échapperait — il n'y en a aucune aujourd'hui.

**Obtenues.**

- L'épisode « vert à 15h00, rouge à 17h28 au même commit » devient une phrase lisible dans
  un résumé de run, le lendemain matin au plus tard.
- Une exception de sécurité ne peut plus survivre à sa raison en silence.
- Dix sondes négatives au total : six pour la porte (`pnpm exceptions --autotest`), quatre
  pour la veille (job `veille-regression-autotest`, dont le point mort).

## Alternatives écartées

| Option                                                    | Pourquoi non                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Étendre `veille-alertes.yml`                              | objet différent (une différence, pas un inventaire) ; le mélange brouillerait son contrat « vert digne de confiance » |
| Stocker un instantané quotidien (cache Actions, artefact) | un instantané est une affirmation de plus qui peut périmer — le défaut qu'on traite                           |
| `.trivyignore.yaml` + `expired_at`                        | fonctionnalité déclarée EXPERIMENTAL par Trivy, et exige `--ignorefile` dans quatre workflows                 |
| Une date d'expiration en commentaire, lue par la porte seule | l'exception continuerait de supprimer la CVE après son échéance ; seule la porte rougirait                    |
| Un rappel d'agenda hors dépôt                             | ne survit pas à la personne qui l'a posé, et ne se relit pas en revue de PR                                   |
