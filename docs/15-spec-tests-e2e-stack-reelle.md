# 15 — Spec & plan : tests E2E sur stack réelle + intégration au processus

|                |                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objet**      | Ajouter un étage de tests **end-to-end sur la pile réelle** (seed → stack dockerisée → vraie UI → assertions) et l'**intégrer au CI et au flux de développement**, pour que toute évolution future soit couverte par un test de parcours. |
| **Statut**     | **Réalisé le 2026-06-06** (planifié le 2026-06-06). Voir [§10. Réalisation](#10-réalisation).                                                                                                                                             |
| **Pré-requis** | Travaux de `docs/14` mergés (seed de référence, API contrats).                                                                                                                                                                            |

---

## 1. Contexte & motivation

Plusieurs régressions ont été **découvertes par l'utilisateur en usage réel**, alors que la suite de
tests (~206 unitaires/composant + pacts) était verte :

- contrats invisibles dans l'UI (le front lisait le `sessionStorage`, pas l'API) ;
- calendrier crèche marquant le **week-end** « gardé » (forme `semaineType` 7 jours non testée) ;
- images Docker **qui démarrent en erreur** (`Cannot find module @opentelemetry/...`).

**Cause racine** : il manque un étage « bout en bout » à la pyramide de tests, et le CI ne **fait pas
tourner** ce qu'il construit. Concrètement, l'existant a deux angles morts :

1. **E2E front mocké** — `apps/web/e2e/parcours.e2e.spec.ts` intercepte le BFF via `page.route`
   (rapide, déterministe, offline) mais **ne valide aucune intégration réelle** : un écart back/front
   (sessionStorage vs API, forme des données) reste invisible.
2. **CI sans exécution** — le job `build-images` (`.github/workflows/ci.yml`) **construit** les images
   (`push: false`, `load: true`) mais ne les **démarre jamais** : un crash au boot (dépendance non
   embarquée par `prune-lockfile`) passe le build sans être détecté.

> Ces deux tests **mockés/non-exécutés restent utiles** (vitesse, déterminisme). Cette phase **ajoute**
> un niveau intégration, elle ne les remplace pas.

---

## 2. Objectifs (Definition of Done)

- **DoD-1** — Une suite E2E « stack réelle » exécute les parcours critiques contre la pile complète
  (`docker compose up`) **sans aucun mock réseau**, en s'appuyant sur le seed de référence (`scripts/seed-demo.mjs`).
- **DoD-2** — Un **smoke-test** démarre la stack en CI et vérifie la santé des services + un appel
  fonctionnel (`GET /api/v1/couts`) — bloquant **après** `build-images`.
- **DoD-3** — La suite E2E stack réelle tourne en CI (job dédié) et est **bloquante avant merge**.
- **DoD-4** — Le processus de dev est documenté : **toute évolution touchant un parcours ajoute/maj un
  test E2E** correspondant (règle d'équipe + checklist PR).
- **DoD-5** — Les parcours rejouent les **vrais cas** (forme de données issue de l'API, projection
  asynchrone NATS prise en compte) — pas de fixtures qui ré-encodent les hypothèses fausses.

---

## 3. Périmètre — parcours critiques à couvrir

1. **Dossier foyer** : créer un foyer + enfants → relire (`GET /foyers/:id`) → identité/tranche correctes.
2. **Contrats via API** : après seed, `/foyers/:id/contrats` **liste les 4 contrats** (régression doc 14).
3. **Planning crèche** : onglet ouvre sur le contrat **actif du mois** ; calendrier marque **uniquement**
   les jours du contrat (lun/mer/jeu/ven), **pas** le week-end (régression `CalendrierCreche`).
4. **Planning ABCM** : cantine/périscolaire n'apparaissent qu'aux jours inscrits, et **pas avant la
   rentrée** (garde de période).
5. **Coût consolidé** : `/couts` reproduit les montants réels (crèche 851,16 €/mois ; transitions ;
   annuel) — **après stabilisation de la projection** NATS→tarification.
6. **Smoke démarrage** : chaque service répond `200` sur son health ; la gateway sert `/api/v1`.

---

## 4. Architecture de test cible

| Niveau                                       | Existant / nouveau | Rôle                                                       |
| -------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Unitaire / composant (vitest)                | existant           | logique pure, rendu isolé                                  |
| Contrat (Pact)                               | existant           | compat gateway ↔ services                                  |
| **E2E front mocké** (`parcours.e2e.spec.ts`) | existant           | parcours UI rapide, offline                                |
| **E2E stack réelle**                         | **nouveau**        | intégration de bout en bout, anti-régression d'intégration |
| **Smoke stack** (CI)                         | **nouveau**        | les images démarrent et répondent                          |

---

## 5. Approche technique

- **Projet Playwright dédié** (ne pas polluer l'E2E mocké) : soit un second `project` dans
  `apps/web/playwright.config.ts` (ex. `e2e-stack`, `testMatch: *.stack.e2e.spec.ts`), soit une config
  séparée. **Pas de `page.route`** : `baseURL` = `http://localhost:4200` servi par le **conteneur web**.
- **Orchestration de la pile** : `docker compose up -d --wait` (attendre les healthchecks), puis
  `node scripts/seed-demo.mjs --verify` (idempotent) pour amorcer un état connu, puis Playwright.
  Teardown : `docker compose down -v`. Encapsuler dans un script (`scripts/e2e-stack.mjs` ou cible Nx).
- **Réutiliser le seed** comme fixture : l'état réel (foyer `ae9cc564…` ou un foyer dédié e2e) est la
  source de vérité. Récupérer l'`id` créé depuis `scripts/.seed-demo-state.json`.
- **Projection asynchrone** : les coûts arrivent via NATS (eventual consistency). Utiliser
  `expect.poll(...)` avec un timeout (≈15 s) sur `/couts`, jamais d'attente fixe.
- **Pièges connus** (voir doc 13/06) : le dossier `e2e/` n'est dans aucun `tsconfig` (Playwright compile
  via esbuild) ; ports 3000/4200/5433-5436/4222 à libérer ; web docker et `nx serve web` se disputent
  4200 (ne pas lancer les deux).

---

## 6. Intégration au processus de développement

- **CI** (`.github/workflows/ci.yml`) :
  - Nouveau job **`smoke-stack`** (`needs: build-images`) : `docker compose up -d --wait` →
    `curl` health des services + `GET /api/v1/couts` → `down -v`. Bloquant.
  - Nouveau job **`e2e-stack`** : monte la pile, seed, lance Playwright `e2e-stack`. Bloquant.
    (Conserver `e2e-web` mocké tel quel pour le feedback rapide.)
- **Règle d'équipe** : _toute évolution qui touche un parcours utilisateur ajoute ou met à jour le test
  E2E stack réelle du parcours concerné._ Ajouter une ligne à la **checklist de PR**.
- **Local** : cible `pnpm nx e2e-stack web` (ou `pnpm e2e:stack`) documentée dans le README.

---

## 7. Découpage en lots

1. **Lot 1 — Harnais** : script d'orchestration (up `--wait` + seed + down), projet Playwright
   `e2e-stack`, 1 parcours pilote (foyer → contrats listés). Vérifie la mécanique.
2. **Lot 2 — Parcours** : planning crèche (week-end exclu), planning ABCM (garde de période), coûts
   (poll projection). Couvre les régressions de la doc 14.
3. **Lot 3 — CI** : jobs `smoke-stack` + `e2e-stack` bloquants ; cache d'images ; budget temps.
4. **Lot 4 — Processus** : checklist PR, README, mise à jour `docs/03` (standards) et `docs/06` (DoD).

---

## 8. Risques & points d'attention

- **Flakiness** : eventual consistency NATS, démarrage de pile → `--wait`, `expect.poll`, `retries: 1`
  en CI déjà en place.
- **Temps CI** : la pile complète est lourde → ne lancer `e2e-stack` que sur les projets **affectés**
  (`nx affected`) et/ou en parallèle des autres jobs.
- **Isolation des données** : préférer un **foyer dédié e2e** (ou `down -v` systématique) pour ne pas
  dépendre d'un état antérieur.
- **Maintenance** : garder les sélecteurs accessibles (rôles/labels) déjà utilisés par l'E2E mocké.

---

## 9. Reliquats liés (hérités doc 14)

- Nettoyer les helpers contrat `sessionStorage` de `apps/web/src/utils/store.ts` (morts).
- Ajouter un **pact** pour `GET /api/v1/contrats` (couverture contrat manquante).

---

## 10. Réalisation

> ✅ **Réalisé le 2026-06-06**. Les cinq DoD (§2) sont atteints. Détail tel que livré ci-dessous ;
> guide de reprise consolidé en [doc 06 — Phase 15](06-etat-davancement.md).

### 10.1 Harnais (DoD-1)

- **Config Playwright dédiée** : `apps/web/playwright.stack.config.ts` — `testMatch: **/*.stack.e2e.spec.ts`,
  **aucun mock réseau** (pas de `page.route`), `baseURL = http://localhost:4200` servi par le conteneur web.
- **Helper de support** : `apps/web/e2e/support/stack.ts` (accès à l'état seedé, sélecteurs partagés).
- **Script d'orchestration** : `scripts/e2e-stack.mjs` enchaîne `docker compose up -d --build --wait`
  (attente des healthchecks) → `node scripts/seed-demo.mjs --verify` (amorçage d'un état connu) →
  Playwright stack → `docker compose down -v` (teardown + purge des volumes).
- **Commandes locales** : `pnpm e2e:stack` (script racine) **ou** `pnpm nx e2e-stack web` (cible Nx).

### 10.2 Parcours couverts (DoD-1 & DoD-5)

Specs `*.stack.e2e.spec.ts` rejouant les vrais cas (forme de données issue de l'API, projection
asynchrone NATS) :

- **Dossier foyer → contrats** : après seed, `/foyers/:id/contrats` liste les 4 contrats (régression doc 14).
- **Planning crèche** : le calendrier marque **uniquement** les jours du contrat (lun/mer/jeu/ven),
  **pas le week-end** (régression `CalendrierCreche`).
- **Planning ABCM** : cantine/périscolaire n'apparaissent qu'aux jours inscrits (garde de période).
- **Coût consolidé** : `/couts` reproduit les montants réels — lu via `expect.poll` (la projection
  NATS → tarification est asynchrone, jamais d'attente fixe).

### 10.3 Intégration CI (DoD-2 & DoD-3)

Deux nouveaux jobs **bloquants** dans `.github/workflows/ci.yml`, en plus de `e2e-web` (mocké, **conservé**
pour le feedback rapide) :

- **`smoke-stack`** : démarre la pile, vérifie la santé des services + un appel fonctionnel
  (`GET /api/v1/couts`), puis `down -v`.
- **`e2e-stack`** : monte la pile, seed `--verify`, lance la suite Playwright stack.

### 10.4 Durcissement du seed (DoD-5)

`scripts/seed-demo.mjs --verify` est un **garde bloquant** : il **sort en `exit 1`** si les coûts attendus
ne sont pas atteints après stabilisation de la projection — l'E2E stack démarre donc sur un état vérifié.

### 10.5 Règle de processus (DoD-4)

- **Règle d'équipe** consignée dans [doc 03 §6 (Tests)](03-standards-developpement.md) : _toute évolution
  qui touche un parcours utilisateur ajoute ou met à jour le test E2E stack réelle (`*.stack.e2e.spec.ts`)
  du parcours concerné._
- **Checklist de PR** : `.github/pull_request_template.md` porte une case dédiée.
- **README** : sous-section « Tests E2E sur stack réelle » (prérequis Docker, commandes, piège du port 4200).

### 10.6 Bug produit trouvé dès la 1ʳᵉ exécution (la phase prouve sa valeur)

La première passe de la suite stack a **immédiatement** détecté un vrai défaut, invisible aux tests
mockés : `CalendrierAbcm` et `CalendrierCreche` affichaient les jours réservés/gardés **sans borner par
la période de validité du contrat**. En forçant l'onglet « Cantine » sur juin 2026 (contrat ABCM
démarrant le 2026-09-01), 14 jours « fantômes » apparaissaient alors que le coût restait nul. **Corrigé**
(filtre `valideDu`/`valideAu` sur les deux calendriers). Détail et suivi (latence `/couts/annuel`,
sérialisation `workers: 1`) en [doc 06 §19.6–19.7](06-etat-davancement.md).
