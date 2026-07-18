## 0.13.0 (2026-07-18)

### 🚀 Features

- **fondations:** scoping par ressource dans chaque service + enforce testé (lot 4) ([#229](https://github.com/EdouardZemb/creche-planner/pull/229))
- **fondations:** assertion d'identité signée gateway→svc en mode observe (lot 3) ([#228](https://github.com/EdouardZemb/creche-planner/pull/228))
- **fondations:** dead-letter + mutualisation du consumer JetStream (lot 1) ([#225](https://github.com/EdouardZemb/creche-planner/pull/225))

### ❤️ Thank You

- Claude Fable 5
- Edouard Zemb @EdouardZemb

## 0.12.0 (2026-07-17)

### 🚀 Features

- **notifications:** accepter un corps edite a l'envoi au service (pipeline + Pact) ([#217](https://github.com/EdouardZemb/creche-planner/pull/217))
- **notifications:** reprise status-aware d'un envoi creche bloque ou echoue (GAP A, Lot 5) ([#218](https://github.com/EdouardZemb/creche-planner/pull/218))
- **notifications:** garde-fou boot URL publique des liens e-mail (Lot 7) ([#216](https://github.com/EdouardZemb/creche-planner/pull/216), [#180](https://github.com/EdouardZemb/creche-planner/issues/180), [#209](https://github.com/EdouardZemb/creche-planner/issues/209))
- **notifications:** rappel du mardi périmé → état terminal ABANDONNE + alerte (Lot 6) ([#215](https://github.com/EdouardZemb/creche-planner/pull/215))
- **notifications:** idempotence de création de l'inbox in-app + compteur COUNT SQL ([#211](https://github.com/EdouardZemb/creche-planner/pull/211))
- **notifications:** ledger de livraison par parent contre la tempête de ré-envoi du récap ([#206](https://github.com/EdouardZemb/creche-planner/pull/206))
- **etablissements:** archivage réel — plus notifié, plus proposable (qualité lot 3) ([#205](https://github.com/EdouardZemb/creche-planner/pull/205), [#203](https://github.com/EdouardZemb/creche-planner/issues/203))
- **etablissements:** fermer l'angle mort « crèche sans e-mail » (brouillon routable) ([#202](https://github.com/EdouardZemb/creche-planner/pull/202))

### 🩹 Fixes

- **notifications:** garder la nullité du snapshot mardi (pas de faux planning modifié) ([#207](https://github.com/EdouardZemb/creche-planner/pull/207))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.11.0 (2026-07-14)

This was a version bump only for svc-notifications to align it with other projects, there were no code changes.

## 0.10.0 (2026-07-09)

### 🚀 Features

- **notifications:** libellés de semaine en clair dans le parcours de validation (lot 4) ([#184](https://github.com/EdouardZemb/creche-planner/pull/184))
- **notifications:** le récap du mardi part toujours — statut persisté + reprise (lot 3) ([#183](https://github.com/EdouardZemb/creche-planner/pull/183))
- **planification:** catégorie datée « ajustements » — heures réelles (Lot 2a) ([#181](https://github.com/EdouardZemb/creche-planner/pull/181))

### 🩹 Fixes

- **planning:** le mail du mardi et la cloche ouvrent l'éditeur de la semaine en 1 tap ([#180](https://github.com/EdouardZemb/creche-planner/pull/180))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.9.0 (2026-07-05)

### 🚀 Features

- **notifications:** émettre SemaineValidee.v1 via l'outbox à la validation d'une semaine ([#168](https://github.com/EdouardZemb/creche-planner/pull/168))

### ❤️ Thank You

- Claude Fable 5
- Edouard Zemb @EdouardZemb

## 0.8.1 (2026-07-03)

### 🚀 Features

- **inbox:** inbox in-app générique (PR6) ([#124](https://github.com/EdouardZemb/creche-planner/pull/124))
- **desabonnement:** désabonnement one-click RFC 8058 (PR5) ([#123](https://github.com/EdouardZemb/creche-planner/pull/123))
- **svc-notifications:** projection préférences notif + filtrage des destinataires e-mail (PR4) ([#122](https://github.com/EdouardZemb/creche-planner/pull/122))

### 🩹 Fixes

- **notifications:** allowlist mailer par destinataire (AN-14) + runtime Docker non-root ([#128](https://github.com/EdouardZemb/creche-planner/pull/128))

### ❤️ Thank You

- Claude Fable 5
- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.8.0 (2026-07-01)

### 🚀 Features

- **inbox:** inbox in-app générique (PR6) ([#124](https://github.com/EdouardZemb/creche-planner/pull/124))
- **desabonnement:** désabonnement one-click RFC 8058 (PR5) ([#123](https://github.com/EdouardZemb/creche-planner/pull/123))
- **svc-notifications:** projection préférences notif + filtrage des destinataires e-mail (PR4) ([#122](https://github.com/EdouardZemb/creche-planner/pull/122))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.7.0 (2026-06-30)

This was a version bump only for svc-notifications to align it with other projects, there were no code changes.

## 0.6.0 (2026-06-30)

### 🚀 Features

- **etablissements:** démantèlement de l'ancien modèle figé (P6) ([#105](https://github.com/EdouardZemb/creche-planner/pull/105))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.5.0 (2026-06-29)

### 🚀 Features

- **svc-notifications:** router envoi/scheduler par établissement réel (P4) ([#101](https://github.com/EdouardZemb/creche-planner/pull/101), [#100](https://github.com/EdouardZemb/creche-planner/issues/100))
- **svc-notifications:** projection établissements + routage récap par lien explicite (P3) ([#100](https://github.com/EdouardZemb/creche-planner/pull/100))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.4.0 (2026-06-28)

### 🚀 Features

- **svc-notifications:** projection parents + récap hebdo groupé par foyer (pr4 parents-foyer) ([#78](https://github.com/EdouardZemb/creche-planner/pull/78))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb

## 0.3.0 (2026-06-26)

### 🚀 Features

- **svc-notifications:** mail récap agrégé par établissement — édition hebdo, phase 4/4 ([#68](https://github.com/EdouardZemb/creche-planner/pull/68))
- lecture agrégée de la semaine éditable + lib partagée semaine (édition hebdo, phase 1/4) ([#65](https://github.com/EdouardZemb/creche-planner/pull/65))
- **svc-notifications:** mail au service relecture + envoi réel tracé (Lot 6) ([#63](https://github.com/EdouardZemb/creche-planner/pull/63))
- **svc-notifications:** scheduler du mardi + mail récap parent (Lot 5) ([#62](https://github.com/EdouardZemb/creche-planner/pull/62))
- **notifications:** validation hebdomadaire du planning + indicateur in-app (Lot 4) ([#61](https://github.com/EdouardZemb/creche-planner/pull/61))
- **notifications:** config établissements destinataires + BFF + écran web (Lot 3) ([#60](https://github.com/EdouardZemb/creche-planner/pull/60))
- **svc-notifications:** read-model des contrats via stream PLANIFICATION (Lot 1) ([#58](https://github.com/EdouardZemb/creche-planner/pull/58))
- **svc-notifications:** scaffold du service notifications (Lot 0) ([#57](https://github.com/EdouardZemb/creche-planner/pull/57))

### ❤️ Thank You

- Claude Opus 4.8
- Edouard Zemb @EdouardZemb
