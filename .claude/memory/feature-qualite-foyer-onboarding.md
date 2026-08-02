---
name: feature-qualite-foyer-onboarding
description: 'Chantier qualité « Ma famille » (foyer + onboarding) — ✅ COMPLET 5/5 + ✅ DÉPLOYÉ PROD 0.11.0 (2026-07-14), reste smoke live PO'
metadata:
  node_type: memory
  type: project
  originSessionId: 59fb5251-4d1c-4042-9f83-c939904a1202
---

Chantier palier qualité du cycle de vie foyer (création/onboarding, édition, enfants, parents),
front + backend. Plan : `.claude/plans/qualite-foyer-onboarding.md` (validé PO 2026-07-11).
**✅ COMPLET 5/5, tout mergé main le 2026-07-11** (orchestration : 1 agent Opus 4.8 par lot en
worktree isolé, pilotage/merges dans la session principale, autorisation merge donnée par le PO) :

1. Gestes destructifs sûrs — **#195 `2c18bad`** : ModaleConfirmation enfant/parent, garde
   `DERNIER_PARENT_ACTIF` (FOR UPDATE en transaction), relais structuré `ErreurAmont`/
   `capturerCorpsErreur` (FoyerClient only), mapping front `parentErreurs.ts`.
2. Création atomique — **#194 `77a7c13`** : POST /api/foyers étendu (enfants≤20/parents≤10/
   `createurEmail`) → dossier complet 201, 1 seule transaction, `parentsAvecCreateur` déplacée
   gateway→svc-foyer, pact régénéré à blanc.
3. Onboarding + fraîcheur — **#196 `b4d346c`** : `MoiContext.recharger()`, formulaire réordonné,
   dashboard 0 contrat → CTA « Créer un contrat », EtatVide en `<Link>` SPA + prop `rechargement`.
4. Édition + « ma famille » — **#197 `17f2071`** : rester sur la page + StatutSauvegarde par
   ligne, « Annuler »→« Rétablir » (dernières valeurs enregistrées), renommage UI complet
   foyer→famille (« Ma famille », « Contact principal (reçoit les e-mails de la crèche en
   premier) »), classes `.page-etroite/.champs-duo/.case-cochable/.actions-ligne`.
5. Intégrité parent — **#198 `6c81c26`** : migration svc-foyer **0003** index partiel
   `(foyer_id, lower(email)) WHERE actif` (multi-foyers + réactivation), réactivation au
   ré-ajout dans `ajouterParent`, GET /v1/foyers scopé non-admin, `@CreationFoyerUnique`
   fail-closed 503 sous enforce, pact 13→17 interactions (409 e-mail/dernier-parent, 404,
   `?parentEmail=`).

**Bug latent corrigé au lot 5** : drizzle-orm ≥0.45 enveloppe les erreurs PG dans
`DrizzleQueryError` (le 23505 est dans `.cause`) → `traduireUnicite` ne voyait JAMAIS les
violations d'unicité en conditions réelles = 500 au lieu de 409. Fix : helper `violationUnicite()`
qui remonte la chaîne des `cause` (borné à 4). Invisible avant car aucune interaction pact
d'erreur + contournement e2e « e-mail unique par run » (supprimé au lot 5).

**Pièges rencontrés pendant l'orchestration** (leçons multi-agents) :

- Les agents classent trop vite un échec local en « environnemental » — exiger le diagnostic
  complet. Vrai flake local `parcours.e2e.spec.ts` ENFIN corrigé (lot 2) : Nest `app.listen`
  écoute IPv6-only sous Windows → URLs `localhost` (pas 127.0.0.1) + budgets boot 90s/120s.
- Provider pact = seul endroit qui exerce les erreurs contre vraie base (skip local sans
  Postgres) → chaque garde métier nouvelle peut casser une interaction nominale (retrait de
  parent a nécessité un état dédié « avec deux parents »).
- Ratchet couverture CI : supprimer du code testé (parentsAvecCreateur) fait baisser la
  couverture → prévoir des tests sur les chemins remplaçants.
- Renommage : les agents ratent les assertions e2e de COMPORTEMENT (pas que les libellés) —
  ex. « retour au planning » supprimé au lot 4.
- Worktrees agents : un worktree peut naître NON enregistré (git résout vers le clone
  principal — vérifier `git worktree list` + `rev-parse --show-toplevel` avant d'éditer) ;
  suppression Windows = `rmdir /s /q "\\?\..."` (chemins longs) ; `gh pr merge --delete-branch`
  échoue si la branche est tenue par un worktree (merger sans, nettoyer après).
- Main protégée exige la branche à jour → `gh pr update-branch` + re-CI (~15 min) entre chaque
  merge : merger les lots dans l'ordre des dépendances pour limiter les cycles.

**✅ DÉPLOYÉ PROD `0.11.0` le 2026-07-14** (12e release train, Deployment #5442718810 ; migration
svc-foyer `0003` vérifiée appliquée = index partiel `parent_email_par_foyer_actif_idx UNIQUE
(foyer_id, lower(email)) WHERE actif`). Reste : smoke live PO (création famille, ré-ajout parent
retiré, multi-foyers). Détail deploy + pièges du train dans [[prod-deployment-facts]].
Lié : [[feature-foyer-cycle-de-vie]], [[feature-parents-foyer]], [[feature-contrat-enfant-id]],
[[prod-deployment-facts]].
