---
name: feature-client-api-retry-timeout
description: Retry borné + timeout AbortSignal sur les appels idempotents du client API web (résilience 4G)
metadata:
  node_type: memory
  type: project
  originSessionId: b7d9a72e-ee1a-457d-894e-a4f05144a01b
---

Client API web (`apps/web/src/api/client.ts`) durci contre les hoquets réseau 4G : nouvelle fonction `requeteIdempotente` = `AbortSignal.timeout(10 s)` composé au signal appelant via `AbortSignal.any`, + rejeu borné (2 tentatives, backoff 500 ms/1,5 s) **uniquement** sur `TypeError` réseau et 502/503/504. **Jamais** de rejeu sur 4xx ni `AuthExpiredError` (redirection Cloudflare Access `redirect: 'manual'` préservée). Corps rejoué à l'identique (sûr = upserts).

Appliqué aux GET + écritures idempotentes : `ecrirePlanning`, `ecrireSemaineBesoins` (upserts), `validerSemaine` (idempotente par clé unique svc-notifications). Écritures non rejouables inchangées (créations/suppressions, `envoyerRecapEtablissement` = envoi mail réel).

**✅ PR [#170](https://github.com/EdouardZemb/creche-planner/pull/170) MERGÉE main (squash `57790e3`, 2026-07-05), pas encore déployée prod** → à embarquer dans le prochain release train (web-only, 0 migration/secret/env). Cf. [[prod-deployment-facts]] (prod @ `0.8.1`).

**Conséquence e2e (PR [#171](https://github.com/EdouardZemb/creche-planner/pull/171), 2026-07-05)** : le rejeu sur PUT signifie qu'UN write logique peut produire PLUSIEURS PUT HTTP (503 → rejeu → 204). Les specs stack « écrire puis recharger » (planning-ajustement/-saisie-complete/-mbt) devenaient flaky : `waitForResponse` sur la seule MÉTHODE se résolvait sur une 1ʳᵉ 503 rejouable, puis `page.reload()` avortait le rejeu → écriture perdue. Fix (helpers partagés `apps/web/e2e/support/stack.ts`) : `attendreEnregistrementPlanning` = PUT **204/200 only** + badge « Enregistré à … », et `rechargerEtRelirePlanning` = attendre la relecture GET après reload (2ᵉ course : réhydratation tardive écrase la saisie optimiste). Règle durable : un `waitForResponse` sur une écriture idempotente DOIT filtrer le **statut de succès**, jamais la seule méthode.

**✅ Dette réhydratation RÉSOLUE + MERGÉE main (garde de séquence applicative, PR [#172](https://github.com/EdouardZemb/creche-planner/pull/172), squash `6316419`, 2026-07-06 ; web-only, 0 migration/secret/env → prochain release train, cf. [[prod-deployment-facts]])** : `useSaisieServeur` prend un 4ᵉ arg `lireSeqLocale: () => number` (défaut `SEQ_ZERO`) et remonte `seqAuChargement` = instantané du compteur figé AU LANCEMENT du GET. `useCalendrierContrat` possède `seqMutationRef` (monotone) + expose `marquerSaisieLocale()` (à appeler à chaque mutation locale) et `saisieServeurObsolete()` = `seqMutationRef.current > seqAuChargement`. Les 2 calendriers (`CalendrierCreche`/`CalendrierAbcm`) : marquent dans `envoyer` (choke point unique — toute édition locale y passe) et gardent l'effet de réhydratation par `if (saisieServeurObsolete()) return;`. Effet : un GET lent qui revient APRÈS une édition locale est ignoré (l'édition prime) ; mount propre inchangé (serveur = source de vérité). Tests : anti-clobber + contre-épreuve dans `CalendrierCreche.test.tsx`/`CalendrierAbcm.test.tsx` (promesse `lirePlanning` différée résolue dans `act`), capture seq dans `useSaisieServeur.test.ts`. **Piège** : le `lireSeqLocale` passé DOIT avoir une identité stable (`useCallback([])`) sinon l'effet `useSaisieServeur` se redéclenche à chaque rendu (boucle de refetch) — vrai dans le hook ET dans le test unitaire.

Pièges rencontrés :

- **prefer-const (error, ratchet)** : `let timer; timer = setTimeout(...)` déclenche prefer-const en flat config ; structurer avec `const timer = setTimeout(...)` + listener abort défini après (pas de forward-ref).
- **noUncheckedIndexedAccess=true** : destructurer `const [delai] = backoffs` donne `number | undefined` → `delai ?? 0` nécessaire (sinon type error), et NON flaggé no-unnecessary-condition.
- **e2e `parcours.e2e.spec.ts` flaky** : `getByText('Cantine')` ambigu (mode strict Playwright) tant que le form de création reste monté (option Mode « Cantine ») → sceller au `.locator('.carte-contrat').filter({ hasText })`. Fiabilisé dans la même PR. Rien à voir avec le code client (vérifié : suite e2e cold 11/11 identique main vs branche). `e2e-web` NON requis (checks requis = `ci` + `config-validation`).
- **gh pr merge --delete-branch en worktree** : échoue à basculer le worktree sur `main` (déjà check-out ailleurs) → le merge GitHub réussit quand même, mais supprimer la branche remote à la main (`git push origin --delete`). Cf. [[repo-clean-clone-location]].
