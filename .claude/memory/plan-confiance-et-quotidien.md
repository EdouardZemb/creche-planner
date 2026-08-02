---
name: plan-confiance-et-quotidien
description: "Chantier « Confiance & quotidien » : 7 lots, EXÉCUTÉ + mergé main 2026-07-18 (orchestration multi-agents), gotchas d'orchestration réutilisables"
metadata:
  node_type: memory
  type: project
  originSessionId: ce47c60e-f6ba-4159-86c7-0843c871089e
---

Chantier issu de la mission carte+plan du 2026-07-18 (plan `.claude/plans/confiance-et-quotidien.md`, carte `.claude/plans/amelioration-2026-07-pistes.md`). Sélection PO = B1+B2 (confiance visible), C1+C2 (intégrité écritures), A1 (absence 2 taps), lot poli (A3+A4+E1+D2+E2).

## ✅ EXÉCUTÉ 7/7 + MERGÉ main 2026-07-18 (tête `0bc7a8d`, orchestration multi-agents Opus 4.8 / Sonnet 5)

Un agent worktree isolé par lot, PR squash + auto-merge. PR → commit main :

- Lot 1 B2 (dashboard : `LigneIndisponible` au lieu de blocs disparus) → #232 `94a89e4`
- Lot 2 B1 (suivi persistant des envois : endpoint lecture svc-notif + BFF + web `SuiviEnvois`) → #231 `5917255`
- Lot 3 C1 (idempotence création contrat+établissement : id généré gateway + `onConflictDoNothing`) → #234 `81d1608`
- Lot 4 C2 (garde monotonie `occurred_at` sur projections) → #235 `c82e070` — **migrations additives svc-tarification `0004` (contrat), svc-notifications `0018` (contrat/etablissement/foyer_parent/preference_notification)** ; secondaire `update(prestation_mois)` laissé non gardé (assumé)
- Lot 5 A1 (« Signaler une absence » 2 taps + `ModaleAbsenceRapide`, read-modify-write du mois) → #236 `4f14b28`
- Lot 6 A3+A4 (ALSH→« Centre de loisirs », « Total du mois », aide simulation) → #233 `c3188d5`
- Lot 7 E1+E2+D2 (FullCalendar en `lazy` → chunk principal **387,91 Ko** <400, était 647 ; 4 PNG PWA ; scroll-padding focus) → #237 `0bc7a8d`
- 0 nouveau secret/env/compose. **Reste : vérif live 375px (humain, ports docker), déploiement release train.**

## Gotchas d'orchestration multi-agents (RÉUTILISABLES — coûté cher ce chantier)

- **Agents worktree qui backgroundent une vérif lente se figent** : `nx test web` à froid (~8-10 min) lancé via `run_in_background` + watcher → le watcher meurt, l'agent « park » indéfiniment et re-notifie sans progresser. FIX : instruire l'agent de **vérifier en FOREGROUND** (un seul appel Bash bloquant `timeout:600000`, jamais `run_in_background`/monitor) — a marché nickel pour lots 4/5/7. Sinon : reprendre la finalisation soi-même (commit/push/PR depuis le worktree, `git -C`).
- **Ne JAMAIS lancer 2+ `nx test web` cold en parallèle** : 4 agents web concurrents ont saturé la machine au point que `tasklist` lui-même timeoutait (2 min). Stagger les lots web (1 à la fois) ; backend (Lot 4) peut tourner à côté d'1 web.
- **`api-gateway:test` (pacts consommateur) FLAKY sous charge** : races de mock-server pact → échec `pact-drift` et/ou `ci` ; **vert en isolation**. Re-run les jobs échoués. Idem provider-pact/testcontainers (`--parallel=1` ou isoler ; « provider non prêt après 40000ms »).
- **`nx format:check` CI** rattrape des fichiers non formatés passés au travers de lint-staged → job `ci` échoue à l'étape « Format check » (le résumé « Aucun projet affecté n'a produit de rapport » est un LEURRE bénin, pas la cause). Fix : `prettier --write` + commit.
- **Branch protection = branche à jour avant merge** : merges strictement séquentiels. Merger un lot → le suivant devient `BEHIND` → `gh pr update-branch` + re-CI + merge. Astuce : `gh pr merge --squash --auto` (fusionne quand vert). (Lots 1/3/6 sont passés d'un coup grâce à la race de mergeability async de GitHub quand mergés en rafale.)
- **Apostrophe** : convention repo = typographique `’` (U+2019, ~51 fichiers), PAS `'` droit. Un `'` droit en texte JSX = **erreur** `react/no-unescaped-entities` (a bloqué Lot 6).
- **Windows Git Bash + accents** : commits/PR via `-F fichier` / `--body-file` (UTF-8) ; sujets `gh pr merge --subject` en ASCII (sans accents) pour éviter le mojibake.

Lié : [[verif-ui-locale-stack]], [[prod-deployment-facts]], [[plan-fondations-backend]] (isolation foyer déjà enforced gateway, faux positif d'audit)
