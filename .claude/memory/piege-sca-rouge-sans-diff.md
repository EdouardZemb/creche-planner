---
name: piege-sca-rouge-sans-diff
description: "Le job `security` de ci.yml peut faire rougir `main` sans qu'aucun commit n'ait touché une dépendance — la base CVE de Trivy bouge sous un arbre figé"
metadata:
  node_type: memory
  type: reference
---

**Le symptôme.** `main` part au rouge sur le job `security` de `ci.yml`, étape
« Audit SCA — dépendances de production (high/critical, BLOQUANT) », alors que le
commit fautif ne touche **ni `package.json` ni `pnpm-lock.yaml`**. Vu le 2026-08-04
sur `0388a8b` (#287, un chantier de documentation/outillage) : le run précédent,
`4718e90`, était vert sur le **même arbre de dépendances**.

**La cause.** Ce n'est pas le diff, c'est la **base CVE de Trivy** qui a bougé
entre les deux runs. L'étape télécharge `trivy-db` à chaque exécution (le cache
`cache-trivy-<date>` ne porte que le binaire et un instantané, `Need to update DB`
apparaît quand même). Une advisory publiée entre deux pushes suffit.

**La méthode de diagnostic.** Avant de chercher un coupable dans le diff, comparer
avec le run précédent sur `main` : même arbre + verdict opposé ⇒ cible mobile.
Lire ensuite la table Trivy de l'étape **bloquante** (la 3ᵉ), pas celle de l'étape
informative qui suit — cette dernière tourne avec `TRIVY_INCLUDE_DEV_DEPS=true` et
liste beaucoup plus de lignes (16 vs 1 le 2026-08-04). Confondre les deux fait
chercher des correctifs pour des paquets de dev qui ne bloquent rien.

**Corollaire : un override pnpm posé contre une CVE n'est pas définitif.**
`brace-expansion` a bloqué la CI deux fois en huit jours :

- 2026-07-28 (#253) — CVE-2026-13149 / CVE-2026-14257 → overrides `brace-expansion@2: ^2.1.2`,
  `brace-expansion@5: ^5.0.8`, et CVE-2026-14257 **assumée** dans `.trivyignore`
  (aucun correctif 2.x publié à l'époque, 5.0.8 = rupture d'API pour minimatch 5/9) ;
- 2026-08-04 — CVE-2026-69152, dont le titre dit explicitement « **bypassing the
  CVE-2026-14257 mitigation** » → overrides remontés à `^2.1.4` / `^5.0.9`, plus
  `brace-expansion@1: ^1.1.18` ajouté (1.1.15 traînait dans l'arbre de dev).

Un plancher `^X` ne remonte pas tout seul : le lock épingle la version résolue, il
faut **remonter le plancher** dans `pnpm.overrides` pour forcer la régénération.

⚠️ **`.trivyignore` : CVE-2026-14257 reste à réviser.** L'entrée disait « réviser dès
qu'un correctif 2.x ou des minimatch corrigés existent » — une ligne 2.x corrigée
existe désormais (2.1.4). Impossible de vérifier depuis une session distante si
2.1.4 couvre aussi 14257 : le proxy bloque `osv.dev` (403 sur le CONNECT) et
`api.github.com/advisories` n'est pas plus accessible. L'entrée est donc **gardée**
— la retirer à l'aveugle rougirait la CI si 14257 n'est pas couverte. À trancher
depuis le poste principal.
