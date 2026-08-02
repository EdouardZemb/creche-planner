---
name: chantier-versionnement-dates-effet
description: "Chantier SFD 30 « Versionnement à date d'effet » : 7/7 lots EXÉCUTÉS + mergés main 2026-07-28 (orchestration multi-agents) ; reste déploiement + smoke PO + CVE lockfile"
metadata:
  node_type: memory
  type: project
  originSessionId: aeb38c9a-5ab3-4270-ae2d-2ddeca98a794
  modified: 2026-08-01T17:02:11.519Z
---

Exécution du plan `.claude/plans/versionnement-dates-effet.md` (SFD 30, socle de la séquence 30→33). Orchestration multi-agents (un agent Opus 4.8 par lot en worktree isolé, lot 7 Sonnet 5), PR squash + auto-merge, merges séquentiels.

## ✅ EXÉCUTÉ 7/7 + MERGÉ main 2026-07-28 (tête `8b7daef`)

- Lot 1 socle `versionnement.ts` shared-kernel → #238 `2dcef2e` (erreurs dans `domain-error.ts`, adaptateurs `depuisBornes`/`depuisSuite`)
- Lot 7 modes consolidés kernel → #239 `a772ad4` (⚠ `referentiel-domain` garde un miroir local documenté : frontière Nx domain→contracts interdite ; `ModeGarde` tarification renommé `PolitiqueTarifaireId`)
- Lot 2 projection = source grilles/PSU → #247 `d87939d` (migrations referentiel `0002`, tarification `0005` ; ré-émission one-shot v2 au boot via `version_payload` — vérifier log « Grilles ré-émises en v2 » au déploiement ; repli REST sinon 503, zéro constante tarifaire dans le code)
- Lot 4 contrat versionné → #248 `e28629d` (migration planification `0008` + back-fill ; cascade `delete(planning_mois)` SUPPRIMÉE ; `PUT /api/v1/contrats/:id` BFF conservé en façade non destructive `version-courante`)
- Lot 3 tranches + foyer versionné → #249 `c6554a0` (migrations referentiel `0003`, foyer `0004` + back-fill, tarification `0006` ; svc-foyer devient consommateur REFERENTIEL, ré-émet tout l'historique v3 à chaque écriture ; `Tranche.depuisRfr(rfr, bareme)`)
- Lot 6 écran Tarifs + publication grille → #251 `5e0678d` (`publierGrille` atomique, 409 `PERIODE_CHEVAUCHANTE` ; oracle OpenAPI 24→27 routes)
- Lot 5 UI avenants/historique/correction → #252 `8b7daef` (menu Modifier → changement à partir du…/corriger/historique ; `moisCommuniques` croisés avec svc-notif `GET /foyers/:id/mois-communiques?du=&au=` ; « Calculé avec » ; e2e `avenant-contrat.stack.e2e.spec.ts`)

## Reste (hors code)

1. **CVE lockfile : PR #253 ✅ MERGÉE main `e802cb6` (2026-07-28)** — overrides pnpm (`propagator-jaeger@2.8.0→2.9.0`, `brace-expansion@2→2.1.3`, `@5→5.0.8`) + 2 exceptions `.trivyignore` validées par Edouard : CVE-2026-14257 (brace-expansion 2.x SANS correctif amont — la v5 casse minimatch 5/9, export nommé vs défaut) et GHSA-qwww-vcr4-c8h2 (react-router 7.18.1, CSRF mode RSC non utilisé ; **fix = v8.3.0, migration majeure à planifier, puis retirer l'exception**). `security` + 7 `build-images` verts. La PR Dependabot #250 est probablement caduque pour le volet CVE. ⚠ `smoke-stack` flaky (503 svc-foyer au seed + doublons `grille_tarifaire_pkey` — passe au rerun).
   1bis. **`e2e-stack` main : ✅ RÉSOLU, PR #254 MERGÉE `a7ddf2d` (2026-07-28), run CI main VERT (après 1 rerun, flaky seed 503)** — 4 causes dans `avenant-contrat.stack.e2e.spec.ts` (spec de #252) : `/recalculé/` ambigu (intros formulaire + modale), date d'avenant fixe → conflit au retry CI (d'où le 2e échec « element(s) not found »), correction post-avenant = version future à 0 mois (aperçu déplacé sur Zoé/Crèche jamais mutée), Annuler `.first()` sous l'overlay. Validé en local : suite stack complète 22 passed + simulation retry sur pile sale. Pièges appris : « Corriger les paramètres actuels » cible la version OUVERTE (`au === null`), pas celle en vigueur aujourd'hui ; le flaky seed 503 (svc-foyer pas prêt derrière la gateway) frappe aussi e2e-stack.
   1ter. **Flaky seed 503 : PR #255 ✅ MERGÉE main `762b8e3` (2026-07-28)** : rejeu borné 502/503 dans l'helper `http()` de `seed-demo.mjs` (fenêtre 30 s, pause 1 s, échec franc sur le reste, polling `--verify` exclu). Validé : gateway factice (503 transitoire absorbé / 500 immédiat / 503 permanent ~31 s) + pile Docker à froid (`--verify` vert, relance idempotente). Devrait éliminer les reruns « 503 au seed » de e2e-stack/smoke-stack (chip task_8eea18a7 traité par cette PR).
2. **✅ DÉPLOYÉ EN PROD `0.14.0` le 2026-07-29** (release train 15, ref `fa585b6`, Deployment #5653284575 `success` — détail dans [[prod-deployment-facts]]). Gateway + svc-planification bien dans le MÊME train. Ré-émission v2 **confirmée à l'émission** (log svc-referentiel « Grilles ré-émises en v2 : 3 », `grille_abcm.version_payload=2`), **MAIS incomplète à la réception** :
   - ⚠️ **DÉFAUT LOT 2 : `grille_tarifaire` ne projette qu'un mode sur trois.** `schema.ts:129` `id: uuid('id').primaryKey()` + `projection.service.ts:339` `id: p.grilleId` — or un même `grilleId` amont est partagé par les 3 modes, donc les 2e/3e modes ne déclenchent pas le `ON CONFLICT (mode,tranche,valide_du)` et violent la PK → **6/9 événements en `dead_letter MAX_LIVRAISONS`**, read-model = `PERISCOLAIRE` seul. Repli REST actif (109 appels/15 min), **coûts justes** (CANTINE sept. = 16 484 c). Chip `task_82d91ec0`. **Les specs n'ont pas vu le bug car elles varient le `grilleId` par événement.**
     - **CORRECTIF : PR #257 — ✅ RÉSOLU EN PROD le 2026-08-01** (déployée par le train `0.15.0`, migration `0007` appliquée, **rejeu de projection joué** : `UPDATE grille_abcm SET version_payload = 1;` + `docker restart creche-planner-svc-referentiel-1` → **9 lignes = 3 modes × 3 tranches**, 0 nouveau dead-letter, repli REST éteint — cf. [[prod-deployment-facts]] et [[plan-consolidation-ui-qualite]] lot R1). Contenu de la PR (mergée main `9818302` le 2026-07-29, CI 15 verts + 1 skip sans rerun) : PK surrogate `id ... defaultRandom()` + colonne de traçabilité `grille_id` ; migration tarification `0007_grille_tarifaire_pk_surrogate` (back-fill `grille_id = id`, `id` existants conservés). Rejouée sur Postgres 16 avec données prod-like → 3 modes × 3 tranches = 9 lignes, rejeu idempotent.
     - ⚠️ **La base factice de `projection.integration.spec.ts` n'appliquait QUE la cible du `ON CONFLICT`, jamais la PK** — c'est ça, le vrai angle mort (un test « 3 modes même grilleId » y serait vert même sans correctif). Durcie pour honorer tous les index d'unicité déclarés (`getTableConfig` : PK + `unique(...)`) ; passer par les **noms** de colonnes, les types de `getTableConfig` et `getTableColumns` n'étant pas assignables entre eux.
     - ⚠️ **Un simple redémarrage de `svc-referentiel` NE re-déclenche PAS la ré-émission** (contrairement à ce qu'on a d'abord supposé) : `reemettreGrillesEnV2()` filtre `where(version_payload < 2)` et la prod est déjà à 2. Rejeu prod = `UPDATE grille_abcm SET version_payload = 1;` **puis** redémarrage (les nouveaux événements ont des `randomUUID()` frais, donc ni la dédup `Nats-Msg-Id` ni `processed_event` ne les bloquent). Aucun outil de rejeu de `dead_letter` n'existe (table en écriture seule).
     - Ce bug est probablement la source des « doublons `grille_tarifaire_pkey` » du `smoke-stack` flaky noté en 1.
   - ⚠️ **read-model `foyer_version` tarification VIDE** : le back-fill du lot 3 est un INSERT SQL direct sans émission d'événement, et svc-foyer ne ré-émet qu'à l'écriture → vide jusqu'à la 1re édition de foyer.
   - Baselines `dead_letter` bénignes de ce déploiement : foyer `TYPE_INCONNU=10` (svc-foyer nouveau consommateur REFERENTIEL sans `filter_subject`), tarif `TYPE_INCONNU=1`, notif `TYPE_INCONNU=144`.
3. Smoke PO : avenant réel (rentrée), coûts août vs septembre ; vérif 375 px (bottom-sheet).
4. Dettes assumées : `contratValideDu` du « Calculé avec » = début du contrat, pas la version résolue au mois (exact hors avenant) ; correction d'une version passée arbitraire non câblée dans l'UI (endpoint existe) ; frais fixes ABCM non versionnés ; warning « déjà envoyé » non couvert par e2e (tests unitaires seulement).

## Pièges découverts (au-delà de [[plan-confiance-et-quotidien]])

- **Les agents se figent en « attente d'une vérif background » malgré l'interdiction** — 3 cas sur ce chantier. Le SendMessage de relance avec ordre « appels bloquants successifs découpés par groupes de projets » fonctionne à chaque fois.
- `nx <svc>:typecheck` est LIB-ONLY (ne typecheck PAS les specs) ; la CI si → reproduire avec `tsc --build tsconfig.spec.json` depuis le dossier du service.
- CI a une **gate de couverture baseline** (échec si −0,5 pt lignes vs main), distincte des seuils vitest — du code neuf massif exige ses tests.
- `gateway.openapi.spec.ts` : oracle « exactement N routes » (27 après ce chantier) + `nx run web:generate-types` obligatoire (job `openapi-types-drift`).
- TS6305 en cascade = une seule vraie erreur TS ; diagnostic `tsc --build tsconfig.json --force --emitDeclarationOnly` depuis le service.
- `nx format:write` reformate ~100 fichiers hors périmètre (churn CRLF, diff vide) → `git restore` groupé xargs avant commit ; heredoc `>>` bloqué en worktree isolé (utiliser Edit/Write).
- Pact provider POST : stateHandler qui nettoie le créneau avant l'interaction 201, sinon 409 sur sa propre écriture à la 2e vérif.
- Docker Desktop peut tomber en API 500 généralisée (aucun `docker` ne passe) → redémarrer Docker Desktop ; le CI fait foi pour provider pacts/e2e.

Lié : [[plan-sfd-30-33-extension-famille]], [[plan-confiance-et-quotidien]], [[prod-deployment-facts]]
