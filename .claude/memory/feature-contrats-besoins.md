---
name: feature-contrats-besoins
description: 'Chantier « Contrats & besoins » (prototype→pro) — plan 3 lots, lot 1 ALSH hebdo en cours (PR A'
metadata:
  node_type: memory
  type: project
  originSessionId: 90fdda75-ab7a-487f-a156-478a3ec98e40
---

Chantier qualité choisi par le PO (2026-07-04) après les chantiers UX dashboard ([[feature-ux-dashboard-jour]]) et planning pro ([[feature-ux-planning-pro]]) : page contrats (`/foyers/:id` → ContratsPage) + robustesse backend. Profondeur validée : front + backend.

**✅ DÉPLOYÉ EN PROD `0.9.0` (2026-07-05 soir, Deployment #5322359168 ref `4f01258`)** avec les 4 chantiers UX + les 5 PR backend des chips (#167→172) ; migration `0005` enfant_id nullable appliquée + **back-fill enfant_id exécuté** (4 contrats rattachés, 0 NULL/8) — détail dans [[prod-deployment-facts]]. Reste : NOT NULL enfant_id (session séparée) + smoke ALSH live PO.

**Ordre PO « merge et continue » reçu 2026-07-04 soir → j'enchaîne les merges (squash + delete branch + --auto, la protection exige update-branch avant merge).**

**Plan validé (3 lots)** — plan détaillé lot 1 : `.claude/plans/alsh-hebdomadaire.md` (non commité) :

1. **ALSH hebdo bout-en-bout** ✅ **COMPLET, TOUT MERGÉ MAIN** : PR A socle backend [#162](https://github.com/EdouardZemb/creche-planner/pull/162) mergée (domaine `InscriptionsJour.alsh {type,repas}` + `ExceptionJour.alsh`, génération explicites>exception>récurrence, zod + pact) ; PR B front [#163](https://github.com/EdouardZemb/creche-planner/pull/163) mergée (ContratForm éditeur par jour, jourFoyer, helper `alshEffectif` besoinsSemaine.ts, CalendrierAbcm récurrence/vert/rouge + portée durable, EditeurContratSemaine ; B2 par sous-agent Opus, revu). ⚠️ preuve live coût impossible localement (images docker antérieures) → smoke staging après release train.
2. **Page contrats pro mobile** ✅ **LIVRÉ — PR [#164](https://github.com/EdouardZemb/creche-planner/pull/164) (`a34f496`), merge auto armé** : cartes mobile-first (.carte-contrat, scrollWidth 447→375 vérifié), Supprimer en **`.btn.danger.contour` (nouvelle variante : contour rouge pour listes, plein réservé aux modales)**, index `/foyers/:id` → redirect dashboard, EtatVide guidant CTA unique, langage (« depuis le … — sans date de fin », « tranche de revenus », « Vos contrats », en-tête épuré), ContratForm : refus client fin<début + garde d'abandon (onChange délégué au `<form>` → ModaleConfirmation), `.table-defilante` cantine/péri. Tout vérifié en preview réel (375px + 1024px, parcours abandon exercé).
3. **Filet de tests parcours critique** ✅ MERGÉ — PR [#165](https://github.com/EdouardZemb/creche-planner/pull/165) : spec `validation-semaine.stack.e2e.spec.ts` (édition semaine → validation VALIDEE_AVEC_MODIFS + delta → 2 revalidations byte-identiques, oracle = réponse réseau du POST UI car PLUSIEURS contrats à valider simultanément) + **affordance `NOTIF_SCHEDULER_FORCER=1`** (svc-notifications : fenêtre mardi ignorée, tick au boot, warning ; posée par docker-compose.override.yml local/e2e uniquement — sans elle le spec skippe 6 j/7). Prouvé en local : orchestration e2e-stack fraîche un samedi → spec PASS. Pièges appris : `nx run web:e2e-stack` = orchestrateur destructif (down -v de la pile locale + up --build) ; port 4200 doit être LIBRE (stopper Vite/preview) ; flaky préexistant `planning-saisie-complete (b)` (course debounce/reload) ; 502 seed possible au boot (circuit breaker svc-foyer). Lot 2 #164 mergée.

**Dette tracée en chips** : contrat↔enfant par prénom libre (task_7e762caf), événement NATS validation (task_204dd7c1), atomicité semaine bi-mois (task_685d5b59), retry client web (task_01143d7c).

**Post-chantier** : PR [#166](https://github.com/EdouardZemb/creche-planner/pull/166) ✅ MERGÉE `2b072c7` (fix specs e2e cassés par le renommage lot 2 : a11y ×2 + foyer-contrats.stack attendaient « Contrats du foyer ») — sa CI a prouvé **e2e-stack COMPLET VERT en CI** (spec validation + scheduler forcé + libellés lot 2). ⚠️ **Seul `ci` est un check REQUIS : e2e-web/e2e-stack rouges ne bloquent PAS l'auto-merge, toujours vérifier `gh pr checks` après merge**. Chip task_ad314a39 : famille de specs stack « écriture debouncée → reload » flaky sous charge locale (3 specs différents sur 5 runs). **CHANTIER CLOS : main `2b072c7`, 5 PR (#162→#166), reste release train + smoke ALSH staging (humain/PO).**

**Pièges appris** :

- ⚠️ **Faux vert par replay de cache nx** : `nx run web:e2e` peut rejouer un résultat caché (logs axe et timings identiques rejoués) même après un rebase qui change les sources → pour toute PREUVE, lancer avec `--skip-nx-cache`.
- Renommer un libellé d'écran ⇒ ratisser `apps/web/e2e/**` (grep l'ancien libellé) — les specs a11y/stack s'accrochent aux headings par nom accessible.
- Pact **merge** les interactions par (description, états) : modifier une interaction existante sans supprimer le fichier → doublons dans le JSON et vérification provider incohérente. **Supprimer `pacts/<pair>.json` et régénérer à blanc.**
- Interactions « nouvelEtablissement » : `resoudreEtablissement` insère toujours (unicité (foyer, nom)) → vérification provider non rejouable sur base locale persistante. Corrigé par états de purge (`purgerEtablissementParNom`) dans le provider spec — pattern à réutiliser pour toute nouvelle interaction de création.
- `apps/api-gateway/src/e2e/parcours.e2e.spec.ts` : flaky en local en suite complète (readiness gateway 30 s dépassée sous contention vitest), passe en isolation — la CI arbitre.
- Après pull/branch : `corepack pnpm@10.34.2 install` sinon webpack-cli 5 résiduel casse les builds (`--config-node-env` inconnu).
- Gateway `ecrirePlanningSchema = z.object({}).passthrough()` : la validation réelle des corps contrat/planning vit dans svc-planification ; MAIS `semaine-besoins.ts` a son propre zod local qui strippe (à maintenir en phase).
