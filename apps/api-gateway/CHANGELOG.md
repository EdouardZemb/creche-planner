## 0.10.0 (2026-07-09)

### 🚀 Features

- **planification:** catégorie datée « ajustements » — heures réelles (Lot 2a) ([#181](https://github.com/EdouardZemb/creche-planner/pull/181))

### 🩹 Fixes

- **planning:** le mail du mardi et la cloche ouvrent l'éditeur de la semaine en 1 tap ([#180](https://github.com/EdouardZemb/creche-planner/pull/180))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.9.0 (2026-07-05)

### 🚀 Features

- **planification:** lier le contrat à l'enfant par enfantId (fin du couplage par prénom libre) ([#167](https://github.com/EdouardZemb/creche-planner/pull/167))
- **planification:** modéliser l'inscription ALSH hebdomadaire de bout en bout ([#162](https://github.com/EdouardZemb/creche-planner/pull/162))

### ❤️ Thank You

- Claude Fable 5
- Edouard Zemb @EdouardZemb

## 0.8.1 (2026-07-03)

### 🚀 Features

- **inbox:** inbox in-app générique (PR6) ([#124](https://github.com/EdouardZemb/creche-planner/pull/124))
- **desabonnement:** désabonnement one-click RFC 8058 (PR5) ([#123](https://github.com/EdouardZemb/creche-planner/pull/123))
- **api-gateway:** profil parent + préférences de notification (BFF, PR2) ([#120](https://github.com/EdouardZemb/creche-planner/pull/120))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.8.0 (2026-07-01)

### 🚀 Features

- **inbox:** inbox in-app générique (PR6) ([#124](https://github.com/EdouardZemb/creche-planner/pull/124))
- **desabonnement:** désabonnement one-click RFC 8058 (PR5) ([#123](https://github.com/EdouardZemb/creche-planner/pull/123))
- **api-gateway:** profil parent + préférences de notification (BFF, PR2) ([#120](https://github.com/EdouardZemb/creche-planner/pull/120))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.7.0 (2026-06-30)

### 🚀 Features

- **foyer:** création unique de foyer par utilisateur (P5) ([#112](https://github.com/EdouardZemb/creche-planner/pull/112))
- **foyer:** éditer et supprimer un enfant (P4) ([#111](https://github.com/EdouardZemb/creche-planner/pull/111))
- **foyer:** gérer parents + ajout d'enfant dans l'écran d'édition (P3) ([#110](https://github.com/EdouardZemb/creche-planner/pull/110))
- **foyer:** exposer + autoriser l'édition d'un foyer par son parent (P1) ([#108](https://github.com/EdouardZemb/creche-planner/pull/108))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.6.0 (2026-06-30)

### 🚀 Features

- **etablissements:** démantèlement de l'ancien modèle figé (P6) ([#105](https://github.com/EdouardZemb/creche-planner/pull/105))
- **planification:** verrou NOT NULL contrat→établissement + lien obligatoire (P5) ([#104](https://github.com/EdouardZemb/creche-planner/pull/104))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.5.0 (2026-06-29)

### 🚀 Features

- **svc-notifications:** router envoi/scheduler par établissement réel (P4) ([#101](https://github.com/EdouardZemb/creche-planner/pull/101), [#100](https://github.com/EdouardZemb/creche-planner/issues/100))
- **svc-notifications:** projection établissements + routage récap par lien explicite (P3) ([#100](https://github.com/EdouardZemb/creche-planner/pull/100))
- **planification:** référence explicite contrat→établissement (P2) ([#99](https://github.com/EdouardZemb/creche-planner/pull/99))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.4.0 (2026-06-28)

### 🚀 Features

- **api-gateway:** enforcement autorisation par foyer derrière flag (pr7 parents-foyer) ([#82](https://github.com/EdouardZemb/creche-planner/pull/82))
- **api-gateway:** provisioning admin + /moi + sélection foyer bornée (pr6 parents-foyer) ([#81](https://github.com/EdouardZemb/creche-planner/pull/81))
- **api-gateway:** guard d'identité cloudflare access observe-only (pr5 parents-foyer) ([#79](https://github.com/EdouardZemb/creche-planner/pull/79))
- **bff-foyer:** crud parents bff + openapi + pact (pr2 parents-foyer) ([#76](https://github.com/EdouardZemb/creche-planner/pull/76))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.3.0 (2026-06-26)

### 🚀 Features

- **web:** horaires planifiés visibles dans l'éditeur hebdo sans ouvrir la saisie ([#69](https://github.com/EdouardZemb/creche-planner/pull/69))
- **svc-notifications:** mail récap agrégé par établissement — édition hebdo, phase 4/4 ([#68](https://github.com/EdouardZemb/creche-planner/pull/68))
- écriture hebdomadaire des besoins (fusion read-modify-write) — édition hebdo, phase 2/4 ([#66](https://github.com/EdouardZemb/creche-planner/pull/66))
- lecture agrégée de la semaine éditable + lib partagée semaine (édition hebdo, phase 1/4) ([#65](https://github.com/EdouardZemb/creche-planner/pull/65))
- **svc-notifications:** mail au service relecture + envoi réel tracé (Lot 6) ([#63](https://github.com/EdouardZemb/creche-planner/pull/63))
- **notifications:** validation hebdomadaire du planning + indicateur in-app (Lot 4) ([#61](https://github.com/EdouardZemb/creche-planner/pull/61))
- **notifications:** config établissements destinataires + BFF + écran web (Lot 3) ([#60](https://github.com/EdouardZemb/creche-planner/pull/60))

### 🩹 Fixes

- **web:** encart validation — distinguer chaque ligne par enfant + mode ([#71](https://github.com/EdouardZemb/creche-planner/pull/71))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.2.0 (2026-06-24)

This was a version bump only for api-gateway to align it with other projects, there were no code changes.

## 0.1.0 (2026-06-22)

### 🚀 Features

- **eslint:** activer le lint type-aware strictTypeChecked + stylisticTypeChecked ([539ddc5](https://github.com/EdouardZemb/creche-planner/commit/539ddc5))

### ❤️ Thank You

- Claude Opus 4.8
- EdouardZemb @EdouardZemb
