---
name: plan-qualite-etablissements
description: 'Chantier qualité feature « établissements » (front+backend) — 4 lots, EXÉCUTÉ 4 PR ouvertes #200/#202/#203/#201 (non mergées)'
metadata:
  node_type: memory
  type: project
  originSessionId: b5177ea0-3ecf-4e96-93e6-20ff5f1fcb7f
---

Chantier qualité **« Les crèches & écoles »** (feature établissements) : faire passer
l'écran + son socle de « prototype » à « produit pro ». Plan `.claude/plans/qualite-etablissements.md`
(auto-portant, format lots), rédigé 2026-07-14.

**✅ EXÉCUTÉ + TOUT MERGÉ SUR MAIN 2026-07-15** (orchestration 4 agents Opus 4.8 en worktrees isolés ; main tip `8a8025c`). Squash-merges :

- **L1** [#200](https://github.com/EdouardZemb/creche-planner/pull/200) `eeed4fb` — langage+finition front « Crèches & écoles ». « Établissements » PAS asserté en nav dans les e2e (commentaires only). A aussi reformulé toasts + modale suppression ; submit **édition** laissé « Enregistrer les modifications » (hors table A).
- **L2** [#202](https://github.com/EdouardZemb/creche-planner/pull/202) `4980624` — brouillon routable (svc-notifications+BFF+web+Pact). `can-i-deploy` COMPATIBLE 5/5, Pact « à blanc ». **Brouillon PAS dans `gateway.openapi.ts`** (type web hand-typé `types/bff.ts`) → branche « interface manuelle ».
- **L3** archivage réel — union `raisonNonRoutable 'SANS_EMAIL'|'ARCHIVE'|null` **priorité ARCHIVE>SANS_EMAIL** ; `resoudreEtablissement(tx,foyerId,dto,etablissementActuel?)` rejette archivé (409) sauf lien inchangé en édition ; `ContratForm` exclut archivés. Scheduler récap-mardi **skippé**. ⚠️ **livré via [#205](https://github.com/EdouardZemb/creche-planner/pull/205) `8a8025c`, PAS #203** (voir mishap ci-dessous).
- **L4** [#201](https://github.com/EdouardZemb/creche-planner/pull/201) `b901470` — module pur `delaiPreavis.ts` (14 tests) + ligne date-limite `EditeurSemaine`. Utils dates réels = `formaterDateCourtFr`/`LIBELLES_JOURS`/`JOURS_SEMAINE`.

**⚠️ MISHAP #203 (leçon PR empilée + strict + merge auto).** #203 (L3, base empilée `feat/etab-lot2-sans-email`) a été **mergée dans sa branche de base au lieu de main** : le merge auto de #202 déclenche le **retarget GitHub de #203 vers main mais AVEC DÉLAI** (>150 s) — `gh pr merge 203` a tourné avant → L3 orpheline hors main. **Fix = [#205](https://github.com/EdouardZemb/creche-planner/pull/205)** : L3 reconstruit sur main par `git merge --squash origin/feat/etab-lot3-archivage` (L2 déjà sur main → ne capture QUE le delta L3 ; conflits L2∩L3 résolus `git checkout --theirs` = version branche L3). Vérifié : L1/L2/L4 intacts, signatures L3 présentes. **Règle : merger une PR empilée = attendre que `baseRefName`==main (poll) AVANT `gh pr merge`, sinon fournir `--base main`.**

**Contexte merge (strict=true).** `main/protection required checks = `ci`+`config-validation`UNIQUEMENT (pas`security`, pas e2e). `strict=true`→ chaque merge re-« BEHIND » les autres → **update-branch (API server-side, évite le verrou worktree) → attendre`ci`→ merge, un par un**, ordre #202→#203→#200→#201. Flake`api-gateway:test`(pact-mock-server/e2e, ports/timing) → 1`gh run rerun --failed` suffit.

**Vérif UI 375px faite (2026-07-15, stack docker + seed + web:4200).** L1 (nav/titre « Crèches & écoles », avertissement sans e-mail sur carte active, archivé « (archivé) » sans avertissement, `.etab-actions` flex-column full-width 44px, 0 overflow, 0 inline style), L3 (sélecteur `ContratForm` exclut l'archivé + « ➕ Créer une nouvelle crèche / école »), L4 (« 🕒 À valider avant jeudi 12:00 (le 16/07) », date = jeudi semaine précédente ✓) confirmés via DOM+CSS calculé. RelectureEnvoi non-routable = couvert par tests (flow live fragile). ⚠️ **screenshot du navigateur mcp HANG (30s timeout) sur ce pane** — read_page/javascript_tool OK ; se rabattre sur DOM+CSS calculé.

**⚠️ CI cassé le 2026-07-15 (indépendant des lots) → corrigé PR [#204](https://github.com/EdouardZemb/creche-planner/pull/204) `f73da1c` MERGÉE.** npm a **retiré l'endpoint `/-/npm/v1/security/audits`** (HTTP 410, cf. pnpm#11265) → job **`security` (`pnpm audit --prod`) échouait sur TOUTES les PR** (pas requis). Fix = `pnpm audit` → **Trivy `fs` sur `pnpm-lock.yaml` (v9)** : lecture directe du lock (0 install), devDeps exclues par défaut = prod-only BLOQUANT (exit 1) + étape `TRIVY_INCLUDE_DEV_DEPS` informative (exit 0) ; mêmes réglages que les autres portes CVE (HIGH,CRITICAL, ignore-unfixed, `trivy-action@v0.36.0` digest, binaire v0.70.0). `pnpm audit` MORT ecosystem-wide (pnpm ≤10.34.2) — cf. [[prod-deployment-facts]].

**Reste** : **release train (déploiement prod, prochaine version MINEURE après 0.11.0)** — 0 migration, 0 secret. Ménage optionnel non fait (refusé/non demandé) : suppression des branches mergées `feat/etab-lot{1,2,3,4}-*`+`ci/fix-security-sca-trivy`+`fix/lot3-archivage-sur-main` (remote, à approuver), dirs worktree `.claude/worktrees/agent-*` non supprimés (Windows « Filename too long » sur node_modules ; git worktree DÉ-enregistrés OK), stack docker de vérif encore up.

**Constat d'audit** : le backend du CRUD établissement est SOLIDE (outbox transactionnel,
unicité 409, garde suppression réelle, projection idempotente `processed_event`, envoi
idempotent `UNIQUE(foyer,semaine,établissement)`) — ne pas le « refaire pour faire joli ».
Les vrais défauts : écran 100 % styles inline + jargon, et **2 angles morts** : (1) crèche
**sans e-mail** → brouillon 404 silencieusement écarté par `RelectureEnvoi` (`allSettled`)
→ parent croit à tort la crèche prévenue ; (2) **archivage cosmétique** (« archivé n'est
plus notifié » affirmé partout mais `actif` jamais filtré dans l'envoi ni au rattachement).

**Décisions PO** (2026-07-14) : langage **reformulé à fond** (« Crèches & écoles », bannir
établissement/préavis/types du texte visible, code/routes/events inchangés) ; **lot 4
préavis in-app inclus** ; **archivage = vraiment inactif** (plus notifié + plus proposable).

**4 lots (1 PR/lot, ordre 1→2→3→4, lot 3 dépend de lot 2)** : L1 langage+finition
design-system de `EtablissementsPage` (Opus, parties string/token délégables Sonnet) ;
L2 brouillon **routable** (backend `svc-notifications` + BFF + web + Pact) ; L3 archivage
réel (`resoudreEtablissement` rejette archivé avec tolérance « lien inchangé » en édition +
`ContratForm` exclut archivés + `routable` intègre `actif`) ; L4 module pur
`web/src/planning/delaiPreavis.ts` + ligne date-limite dans `EditeurSemaine`.

**Dé-risquant** : **0 migration** (routable calculé, `actif` existe déjà), 0 nouvelle dép,
0 renommage route/event. Préavis déjà projeté + exposé par `semaine/besoins` → L4 front-only.

Voir [[feature-etablissements-entite-libre]] (feature d'origine, prod 0.6.0).
