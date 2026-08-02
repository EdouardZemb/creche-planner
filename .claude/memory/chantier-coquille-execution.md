---
name: chantier-coquille-execution
description: 'Chantier n°9 « qualité coquille & navigation » (9 lots) — ✅ COMPLET : mergé main, ops L7 faite, DÉPLOYÉ PROD 0.12.0'
metadata:
  node_type: memory
  type: project
  originSessionId: d7d853ce-99de-4ff7-98ae-9a89f21d9e28
---

Chantier **qualité coquille & navigation** (plan `.claude/plans/qualite-coquille-navigation.md`, [[plan-qualite-coquille-navigation]]). **✅ CODE-COMPLET 9/9 MERGÉ main `f6ae8f3` (2026-07-17)**, orchestration multi-agents Opus 4.8 (workflow worktrees + agents séquentiels pour la chaîne web).

**Les 9 PR mergées** : L1 #214 `e5db60f` (PWA/a11y coquille) · L6 #215 `a131d99` (rappel ABANDONNE) · L7 #216 `52dbe3a` (garde-fou boot URL) · L5 #218 `a8364b9` (reprise envoi crèche GAP A) · L2 #219 `203a0bb` (ChargementPage + annonce titre réel) · L8 #217 `2ff0200` (mail corps édité + Pact) · L3 #220 `2f36c5a` (sélecteur familles) · L9 #221 `3ffd05a` (brouillon semaine éditable) · L4 #222 `f6ae8f3` (hors-ligne/cache).

**Décisions PO (2026-07-16)** : fusion dans l'ordre + vagues enchaînées ; **domaine public L7 = `https://creche.testlens.dev`** (confirmé).

**✅ RELEASE TRAIN FAIT — DÉPLOYÉ PROD `0.12.0` le 2026-07-17** (ref `4a4fab9`, Deployment #5486216914 par le poller, cf. [[prod-deployment-facts]]). svc-notifications booté, garde-fou L7 satisfait.

**✅ ACTION OPS L7 EXÉCUTÉE (2026-07-17)** — mais PAS comme prévu au plan. Le plan proposait « poser `SERVER_ORIGIN` OU découpler » : **le découplage était OBLIGATOIRE**, pas optionnel. `SERVER_ORIGIN` sert aussi de **repli à `GATEWAY_URL` dans `scripts/deploy.mjs`** (portes santé/seed/perf) → la basculer sur le domaine public envoie la porte 3 sur **Cloudflare Access (302 ≠ 200)** → échec + **rollback**. D'où [PR #223](https://github.com/EdouardZemb/creche-planner/pull/223) (`35d66f5`) : `docker-compose.server.yml` → `NOTIF_APP_URL: ${NOTIF_APP_URL:-${SERVER_ORIGIN:?}}` (idem `NOTIF_PUBLIC_API_URL`), puis `NOTIF_APP_URL`/`NOTIF_PUBLIC_API_URL=https://creche.testlens.dev` posées dans `.env.server.enc`. **CORS et portes de déploiement strictement inchangés.** Détail + méthode dans [[prod-deployment-facts]].

**Reste : smoke fonctionnel live (humain/PO)** : PWA offline (bannière + cache `api-lecture-v1`) ; sélecteur multi-foyer ; **mail au service édité en DRY-RUN** (le texte parti = texte édité) ; ouvrir le lien du mail du mardi (doit être `https://creche.testlens.dev/foyers/…`, joignable hors-LAN — certificat vérifié valide).

**⚠️ PIÈGE MAJEUR RENCONTRÉ — auto-merge sémantiquement faux L5×L8** : `git merge` a fusionné envoi.service.ts SANS conflit textuel mais le résultat DROPPAIT le corps édité (stockait l'édité, envoyait le régénéré). Corrigé par un **brouillon effectif `bEffectif`** unique qui alimente insert + reprise + envoi (`envoyer` calcule bEffectif = corpsEdite ? {...b, sujet, corps:echapperEnHtml, texte} : b, passé à reprendreOuRendre/executerEnvoi ; le mailer de executerEnvoi utilise b.sujet/b.corps/b.texte). **Toujours INSPECTER un auto-merge de 2 lots touchant la même fonction, ne pas se fier à « 0 conflit ».** Validé en full CI (e2e-stack = provider Pact Postgres).

**Autres pièges d'exécution** : (1) worktree neuf → tests web cassent sur `@creche-planner/shared-semaine`/`contracts-kernel` non buildés → `nx run-many -t build -p shared-semaine contracts-kernel` AVANT `nx test web`. (2) TS6305 flaky (`tsc --build` dist périmé) → nettoyer `*.tsbuildinfo` + `dist`/`out-tsc`. (3) JAMAIS `2>&1` sur nx en PowerShell 5.1 (fausse le code retour). (4) Branch protection = « up to date with base » requis + `--admin` BLOQUÉ par le classifier → cascade `gh pr update-branch` → CI → `gh pr merge --squash` par lot. (5) un sous-agent peut s'arrêter mid-verify (typecheck en tâche de fond) → reprendre/finir soi-même. (6) L1/L5/L6/L7 disjoints du web → merges backend sans risque ; L5×L8 = seule vraie réconciliation.
