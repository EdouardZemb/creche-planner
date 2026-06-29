## 0.5.0 (2026-06-29)

### 🚀 Features

- **web:** établissements en entité libre par foyer — écran CRUD + sélecteur contrat (P4) ([#102](https://github.com/EdouardZemb/creche-planner/pull/102))
- **svc-notifications:** router envoi/scheduler par établissement réel (P4) ([#101](https://github.com/EdouardZemb/creche-planner/pull/101), [#100](https://github.com/EdouardZemb/creche-planner/issues/100))
- **svc-notifications:** projection établissements + routage récap par lien explicite (P3) ([#100](https://github.com/EdouardZemb/creche-planner/pull/100))
- **web:** sélecteur de type d'ajustement à la saisie d'absence crèche (p3) ([#86](https://github.com/EdouardZemb/creche-planner/pull/86))
- **web:** 3e état « Ajusté » (ambre) à l'affichage du planning crèche (pr2) ([#85](https://github.com/EdouardZemb/creche-planner/pull/85))
- **web:** module pur de classification d'une absence sur un jour gardé (p1) ([#80](https://github.com/EdouardZemb/creche-planner/pull/80))

### 🩹 Fixes

- **web:** adapter les e2e-stack au sélecteur de type d'absence (régression #86) ([#88](https://github.com/EdouardZemb/creche-planner/pull/88), [#86](https://github.com/EdouardZemb/creche-planner/issues/86))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.4.0 (2026-06-28)

### 🚀 Features

- **api-gateway:** provisioning admin + /moi + sélection foyer bornée (pr6 parents-foyer) ([#81](https://github.com/EdouardZemb/creche-planner/pull/81))
- **web:** bloc parents répétable dans le formulaire foyer (pr3 parents-foyer) ([#77](https://github.com/EdouardZemb/creche-planner/pull/77))
- **bff-foyer:** crud parents bff + openapi + pact (pr2 parents-foyer) ([#76](https://github.com/EdouardZemb/creche-planner/pull/76))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.3.0 (2026-06-26)

### 🚀 Features

- **web:** éditeur hebdo — rangées par jour sur une ligne et boutons alignés (responsive) ([#70](https://github.com/EdouardZemb/creche-planner/pull/70))
- **web:** horaires planifiés visibles dans l'éditeur hebdo sans ouvrir la saisie ([#69](https://github.com/EdouardZemb/creche-planner/pull/69))
- **svc-notifications:** mail récap agrégé par établissement — édition hebdo, phase 4/4 ([#68](https://github.com/EdouardZemb/creche-planner/pull/68))
- **web:** éditeur hebdomadaire consolidé des besoins depuis la notification — édition hebdo, phase 3/4 ([#67](https://github.com/EdouardZemb/creche-planner/pull/67))
- écriture hebdomadaire des besoins (fusion read-modify-write) — édition hebdo, phase 2/4 ([#66](https://github.com/EdouardZemb/creche-planner/pull/66))
- lecture agrégée de la semaine éditable + lib partagée semaine (édition hebdo, phase 1/4) ([#65](https://github.com/EdouardZemb/creche-planner/pull/65))
- **svc-notifications:** mail au service relecture + envoi réel tracé (Lot 6) ([#63](https://github.com/EdouardZemb/creche-planner/pull/63))
- **notifications:** validation hebdomadaire du planning + indicateur in-app (Lot 4) ([#61](https://github.com/EdouardZemb/creche-planner/pull/61))
- **notifications:** config établissements destinataires + BFF + écran web (Lot 3) ([#60](https://github.com/EdouardZemb/creche-planner/pull/60))

### 🩹 Fixes

- **web:** encart validation — distinguer chaque ligne par enfant + mode ([#71](https://github.com/EdouardZemb/creche-planner/pull/71))
- **web:** supprime le débordement de page à 320px sur le planning crèche ([#56](https://github.com/EdouardZemb/creche-planner/pull/56), [#55](https://github.com/EdouardZemb/creche-planner/issues/55))
- **web:** largeur du planning crèche stable à la saisie sur mobile ([#55](https://github.com/EdouardZemb/creche-planner/pull/55))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.2.0 (2026-06-24)

### 🚀 Features

- **web:** adapte l'UI au mobile (cibles tactiles, calendrier, modales) ([#53](https://github.com/EdouardZemb/creche-planner/pull/53))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.1.0 (2026-06-22)

### 🚀 Features

- **web:** activer le React Compiler (babel-plugin-react-compiler 1.0) ([225a3e0](https://github.com/EdouardZemb/creche-planner/commit/225a3e0))
- **web:** regles ESLint React (react, react-hooks, jsx-a11y) ([792c078](https://github.com/EdouardZemb/creche-planner/commit/792c078))
- **eslint:** activer le lint type-aware strictTypeChecked + stylisticTypeChecked ([539ddc5](https://github.com/EdouardZemb/creche-planner/commit/539ddc5))
- **web:** migration React 19 + Vite 8 + Vitest 4 ([#17](https://github.com/EdouardZemb/creche-planner/pull/17), [#5](https://github.com/EdouardZemb/creche-planner/issues/5), [#7](https://github.com/EdouardZemb/creche-planner/issues/7), [#8](https://github.com/EdouardZemb/creche-planner/issues/8))

### 🩹 Fixes

- **eslint:** exclure les tests web du lint type-aware + restaurer les casts ([3dcc803](https://github.com/EdouardZemb/creche-planner/commit/3dcc803))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb
- EdouardZemb @EdouardZemb
