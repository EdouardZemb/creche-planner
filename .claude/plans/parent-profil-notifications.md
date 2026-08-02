# Profil parent en self-service + préférences de notification — document de conception

> **Statut au 2026-07-29** : ✅ **FAIT** — les 7 PR du §8 sont mergées (#119→#125, 2026-07-01) et déployées **prod `0.8.0`** (migrations svc-foyer `0002_unique_naoko` + svc-notifications `0011`/`0012`, secret `DESABONNEMENT_TOKEN_SECRET` posé).
> Consolidé ensuite par le chantier qualité « Profil & communication » (8/8 lots, #206→#213, **prod `0.12.0`**). Le « Statut : conception » ci-dessous est historique. Reste hors code : smoke live PO.

> Statut : **conception.** Décisions produit prises (2026-07-01) :
> **Axe A = A1** (page « Mon profil » ciblée sur le parent connecté, sans nouveau champ).
> **Axe B = N3** (préférences par type × canal + désabonnement RGPD one-click + inbox in-app).
> **Validation hebdo** = notification de service : **canal configurable mais jamais coupée
> totalement** (invariant « au moins un canal actif »).
> Ce document prolonge [`parents-foyer-modelisation.md`](parents-foyer-modelisation.md) (auth B1 +
> parents identifiables, **déjà en prod**). Web push reste hors périmètre mais le modèle doit
> rester compatible (`parent.id` = futur propriétaire d'abonnement).

## 1. Objectif

Donner au **parent connecté** (identité CF Access vérifiée, cf. plan auth) la maîtrise de :

1. **Ses informations personnelles** — une page « Mon profil » dédiée, ciblée sur _lui_ (et non
   sur tous les parents du foyer comme l'écran d'édition foyer actuel).
2. **La façon dont il reçoit les notifications** — quel **type** (validation hebdo, récap, futurs),
   par quel **canal** (e-mail / in-app / futur push), avec **consentement tracé** et **désabonnement
   one-click** conforme (RFC 8058), sans jamais pouvoir se rendre injoignable pour une notification
   _de service_ (invariant §5.3).

Sans rien casser de l'existant (auth, garde-fous mailer `dryRun`/`allowlist`, projection
`foyer_parent`, idempotence `notification_hebdo`).

## 2. État des lieux vérifié (audit 2026-07-01)

### 2.1 Auth — déjà en place (rappel)

- CF Access → `IdentiteGuard` pose `request.identite.email` (JWT validé, jamais le header brut) —
  `apps/api-gateway/src/security/identite.guard.ts`.
- `GET /api/v1/moi` → `MoiVue { email, admin, foyers[] }` — `apps/api-gateway/src/bff/moi.controller.ts`.
- Web : `MoiContext`/`useMoi()` — `apps/web/src/session/MoiContext.tsx`.
- Résolution `email → foyers` : `foyersParEmail()` (`SELECT DISTINCT foyer_id FROM parent WHERE
lower(email)=? AND actif=true`) — `apps/svc-foyer/src/foyer/foyer.service.ts`.
- Isolation par foyer derrière `FOYER_AUTHZ_ENFORCE` (`AppartenanceGuard` + `@FoyerScope`).

### 2.2 Profil parent — éditable mais diffus

- Édition dans l'écran **foyer** : `apps/web/src/foyer/FoyerModifierPage.tsx` → bloc
  `ParentsSection.tsx` (`LigneParentExistant` : `email`, `prenom`, `nom`, `principal`).
- CRUD REST `POST|GET|PUT|DELETE /foyers/:id/parents[/:parentId]`
  (`apps/svc-foyer/src/foyer/foyer.controller.ts`), DTO Zod (`foyer.dto.ts`), service transactionnel
  - outbox (`foyer.service.ts`), events `foyer.ParentAjoute/Modifie/Retire.v1`.
- **Manque** : aucune notion de « **mon** profil » (parent = `moi.email`) ; l'écran édite _tous_ les
  parents indistinctement.

### 2.3 Notifications — deux types, zéro préférence

| Type                             | In-app                                                                 | E-mail                | Table                |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------- | -------------------- |
| Validation hebdo (mardi)         | Encart `A_VALIDER` (`apps/web/src/notifications/EncartValidation.tsx`) | `recapMardi.ts`       | `notification_hebdo` |
| Récap au service (établissement) | —                                                                      | `brouillonService.ts` | `envoiEtablissement` |

- Routage destinataires : `apps/svc-notifications/src/destinataires/destinataires.service.ts`
  `emailsActifs(foyerId)` sur la projection NATS locale `foyer_parent`.
- Garde-fous : `dryRun` (true par défaut), `allowlist`, repli `NOTIF_EMAIL_PARENT`
  (`apps/svc-notifications/src/config.ts`).
- **Confirmé par grep** : aucune notion de `preference|opt.in|opt.out|channel|subscription|
consentement`. Pas d'inbox in-app générique (l'in-app = statut `A_VALIDER`, pas de lu/non-lu).

## 3. Où vivent les préférences ? → **svc-foyer** (agrégat propriétaire du parent)

Le `parent` est un agrégat de **svc-foyer**, qui émet déjà des événements projetés vers
svc-notifications (`foyer_parent`). On y ajoute les préférences ⇒ **aucun nouveau Pact**, svc-
notifications reste un pur consommateur/projection. C'est le choix idiomatique (même patron que la
feature parents).

### 3.1 Modèle de données (svc-foyer)

**Table dédiée `preference_notification`** (pas des colonnes sur `parent` : cardinalité type×canal
variable, extensible sans migration à chaque nouveau type — même raisonnement que « table `parent`
plutôt que `email1/email2` sur `foyer` »).

```
preference_notification
  id                uuid PK default gen_random_uuid()
  parent_id         uuid NOT NULL  FK -> parent(id) ON DELETE CASCADE
  type_notification varchar(64) NOT NULL   -- 'VALIDATION_HEBDO' | 'RECAP_SERVICE' | ... (enum applicatif)
  canal             varchar(32) NOT NULL   -- 'EMAIL' | 'IN_APP' | (futur) 'PUSH'
  actif             boolean     NOT NULL default true
  consentement_at   timestamptz NULL       -- trace opt-in explicite (RGPD)
  desabonne_at      timestamptz NULL       -- trace opt-out (via lien one-click ou écran)
  source_dernier    varchar(32) NOT NULL default 'DEFAUT' -- 'DEFAUT'|'ECRAN'|'LIEN_DESABO'
  created_at        timestamptz NOT NULL default now()
  updated_at        timestamptz NOT NULL default now()
  UNIQUE (parent_id, type_notification, canal)
```

- Absence de ligne = **valeur par défaut applicative** (cf. matrice §5.1). On ne matérialise une
  ligne que lorsqu'un choix explicite est posé ⇒ pas de back-fill massif, migration purement additive.
- Branded id `preferenceNotificationIdSchema = z.string().uuid().brand<'PreferenceNotificationId'>()`
  dans `contracts-foyer`. `type_notification` / `canal` = enums Zod partagés (`contracts-foyer`).

**Table `desabonnement_token`** (pour le lien one-click sans login, §5.4) :

```
desabonnement_token
  jti          uuid PK               -- identifiant de jeton (dans le JWT signé)
  parent_id    uuid NOT NULL FK -> parent(id) ON DELETE CASCADE
  type_notification varchar(64) NOT NULL
  canal        varchar(32) NOT NULL
  emis_le      timestamptz NOT NULL default now()
  utilise_le   timestamptz NULL      -- one-shot: null tant qu'inutilisé
  expire_le    timestamptz NOT NULL
```

> Alternative envisagée : jeton **auto-porteur signé** (HMAC/JWT) sans table, révoqué par rotation de
> secret. Retenu : **table + jti** pour l'audit RGPD (preuve du désabonnement) et l'usage one-shot.

### 3.2 Migration générée (jamais à la main)

- `pnpm drizzle-kit generate` sur svc-foyer → prochaine migration additive (ex.
  `0002_preference_notification.sql` + snapshot + `meta/_journal.json`).
- Ajout de deux tables neuves ⇒ **pas d'arbitrage drop-vs-rename** (pas de piège TTY drizzle-kit).
  Ne jamais éditer le `.sql` à la main.

### 3.3 Événement domaine (outbox)

`foyer.PreferencesNotifModifiees.v1` — **état complet** des préférences du parent (les consommateurs
projettent sans relire) :

```
{ foyerId, parentId, preferences: [ { typeNotification, canal, actif, consentementAt?, desabonneAt? } ] }
```

Émis dans la **même transaction** que l'écriture via l'`OutboxRelay` existant → stream `FOYER`.
Payload PII (identifie un parent) : acceptable (flux interne), à mentionner §7.

## 4. Axe A — Page « Mon profil » (A1)

### 4.1 BFF

- `GET /api/v1/moi/profil` → résout le parent courant : `foyersParEmail(moi.email)` puis la ligne
  `parent` correspondante (gère 0/1/N foyers ; si N, profil = e-mail-clé + préférences agrégées par
  parent-identité). Retourne `MonProfilVue { parentId, foyerId, email, prenom, nom, principal,
preferences[] }`.
- Édition : réutilise `PUT /foyers/:id/parents/:parentId` **sous `@FoyerScope('param:id')`** — pas de
  nouvel endpoint d'écriture profil ⇒ garde l'isolation existante. Le BFF vérifie que `:parentId`
  appartient bien à `moi` (défense en profondeur : un parent ne modifie que sa propre ligne).

### 4.2 Web

- Route `/mon-profil` (lien dans l'entête, à côté de « Mes foyers »). Composant réutilisant
  `LigneParentExistant` restreint à _soi_ + le **bloc « Notifications »** (§5.5).
- Data-fetching : pattern maison (`useAsync` comme `useNotifications.ts`/`MoiContext`), pas de
  react-query. a11y calquée sur `EtablissementsPage`/`ParentsSection` (`type="email"`, `aria-*`,
  `role="alert"`, focus sur erreur).

> **Pas de nouveau champ profil** (décision A1) ⇒ aucune migration côté `parent`, aucun bump
> d'événement `ParentModifie`. Si un jour on veut `telephone`/`langue`, c'est A2 (hors périmètre ici).

## 5. Axe B — Préférences de notification (N3)

### 5.1 Matrice type × canal (valeurs par défaut)

| Type               | Nature                          | E-mail défaut | In-app défaut | Opt-out autorisé ?                                                                                                                     |
| ------------------ | ------------------------------- | ------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_HEBDO` | **Service** (transactionnel)    | ✅ on         | ✅ on         | Canal configurable, **≥ 1 canal actif obligatoire**                                                                                    |
| `RECAP_SERVICE`    | Service (sortant établissement) | ✅ on         | —             | Le récap **au service** part quoi qu'il arrive (obligation vis-à-vis de l'établissement) ; on n'expose pas de préférence parent dessus |
| (futur) `PUSH_*`   | —                               | —             | —             | À la carte                                                                                                                             |

> Décision actée : la **validation hebdo** ne peut jamais être coupée totalement. L'écran empêche de
> désactiver le dernier canal actif ; l'API refuse (400) une combinaison « tous canaux off » pour un
> type de service.

### 5.2 Projection dans svc-notifications

- Nouveau durable `notifications-preferences` sur le stream `FOYER`, projetant une table locale
  `preference_notification` (`parent_id, type_notification, canal, actif`), idempotence via
  `processed_event` (déjà en place). Alimentée par `foyer.PreferencesNotifModifiees.v1`.
- **Réutilise le consumer existant** `foyer_parent` (même stream `FOYER`, même
  `jetstream.consumer.ts`) : on ajoute juste la branche de projection pour le nouveau type d'event.

### 5.3 Application au routage (destinataires)

- `destinataires.service.emailsActifs(foyerId, typeNotification)` : filtre désormais les parents
  actifs **ET** dont la préférence `(type, 'EMAIL')` est `actif` (ligne absente ⇒ défaut §5.1).
- **Invariant service** : pour un type transactionnel, si un parent a coupé l'e-mail mais gardé
  l'in-app, il **n'apparaît pas** dans les destinataires e-mail mais reçoit l'in-app (§5.6). Le repli
  `NOTIF_EMAIL_PARENT` ne s'applique que si **aucun** parent n'a d'e-mail actif (comportement actuel
  préservé).
- Garde-fous mailer (`dryRun`/`allowlist`) **inchangés** — un mauvais déploiement ne spammera pas.

### 5.4 Désabonnement one-click (RFC 8058)

- Chaque e-mail sortant porte les en-têtes **`List-Unsubscribe`** (URL + `mailto:`) et
  **`List-Unsubscribe-Post: List-Unsubscribe=One-Click`** (`MailerService` dans
  `@creche-planner/nest-commons` — à étendre, garde-fous conservés).
- Endpoint **public** `POST /api/v1/desabonnement` (`@Public()`, hors `IdentiteGuard`/`FoyerScope`),
  paramètre = jeton signé (jti en table `desabonnement_token`). Vérifie signature + non-expiré +
  non-utilisé (one-shot), puis pose `desabonne_at` + `actif=false` sur la préférence ciblée et émet
  `PreferencesNotifModifiees.v1`. Refus (409) si type de service et dernier canal ⇒ page « ce canal
  ne peut être coupé, gérez vos préférences ».
- Sécurité : jeton lié à `(parent, type, canal)`, expirant, one-shot, aucune énumération possible.
  Rate-limit (guard existant) sur l'endpoint public.

### 5.5 UI « Notifications » (dans /mon-profil)

- Un tableau type × canal (cases à cocher), état chargé depuis `GET /moi/profil`, écriture via
  `PUT /moi/preferences` (BFF → svc-foyer). Désactivation du dernier canal d'un type de service =
  case verrouillée + libellé explicatif. a11y complète.

### 5.6 Inbox in-app générique (volet in-app de N3)

- Table `notification` dans svc-notifications (`id, parent_id, type, sujet, corps, cree_le, lu_le`),
  alimentée au même moment que l'e-mail (le canal `IN_APP` d'une préférence active crée une ligne).
- BFF : `GET /api/v1/moi/notifications` (liste + compteur non-lus), `POST .../:id/lu`.
- Web : cloche + compteur dans l'entête, panneau liste. Réutilise le style `EncartValidation`.
- **Compat** : l'encart `A_VALIDER` existant reste la source de vérité _actionnable_ de la validation ;
  l'inbox est un journal informationnel (ne duplique pas l'action « Valider »).

> Volet in-app livrable **séparément** (dernier lot) : les préférences e-mail + désabonnement
> apportent déjà l'essentiel de la valeur et de la conformité.

## 6. Impacts transverses (standards du repo)

- **Contrats** (`contracts-foyer`) : `preferenceNotificationIdSchema`, enums `typeNotification`/`canal`,
  schéma + payload `PreferencesNotifModifiees.v1`, DTO préférences.
- **OpenAPI hand-authored** (`libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts`) : nouveaux
  schémas (`MonProfilVue`, `PreferenceVue`), routes `/moi/profil`, `/moi/preferences`,
  `/moi/notifications[/:id/lu]`, `/desabonnement`. **Régénérer** `openapi-types.gen.ts`
  (`pnpm nx run web:generate-types`) + **mettre à jour le test « expose exactement N routes »** →
  gate `openapi-types-drift`.
- **Pact** : provider states svc-foyer enrichis ; **aucune nouvelle paire** (option projection NATS)
  ⇒ `can-i-deploy.mjs` inchangé.
- **Tests** : unit `*.spec.ts` (service préférences, invariant ≥1 canal, désabo one-shot), projection
  idempotente, property-based si pertinent, e2e `*.stack.e2e.spec.ts` (parent coupe l'e-mail → n'est
  plus destinataire ; désabonnement via lien). Rappel piège : `nx test` ne typecheck pas →
  `nx run-many -t typecheck test -p web`.
- **Migrations** : générées drizzle-kit, additives (2 tables), snapshot + `_journal.json`.

## 7. RGPD / sécurité

- **Base légale** : notifications _de service_ = intérêt légitime (exécution du service) ; on trace
  quand même `consentement_at`/`desabonne_at` pour l'auditabilité et pour préparer d'éventuelles
  notifications non-essentielles (qui, elles, exigeraient un opt-in explicite).
- **Droit d'opposition** : désabonnement one-click (RFC 8058) + écran de préférences. Le récap _au
  service_ (sortant vers l'établissement) n'est pas une communication _au parent_ et n'est pas
  désabonnable côté parent — à documenter.
- **Effacement** : `ON DELETE CASCADE` depuis `parent` (suppression foyer ⇒ préférences + tokens
  supprimés).
- **Endpoint public de désabonnement** : jeton signé, expirant, one-shot, rate-limité ; pas
  d'énumération, pas de fuite d'existence de compte.
- **PII dans les événements** : `parentId` + préférences ; flux interne, chiffrement at-rest disque
  (position inchangée vs plan parents §7).

## 8. Découpage en PR phasées (1 phase = 1 PR, CI verte à chaque étape)

> Principe : **modèle + préférences d'abord (sans risque), application au routage ensuite,
> désabonnement public et inbox in-app en fin de chaîne.** Garde-fous mailer intacts partout.

- **PR 1 — svc-foyer : modèle préférences + CRUD + événement.**
  Contrats (`preferenceNotificationIdSchema`, enums, `PreferencesNotifModifiees.v1`). Schéma drizzle
  `preference_notification` + migration générée. Service (`lirePreferences`/`majPreferences`
  transactionnel + outbox, invariant ≥1 canal pour type de service). Controller
  `GET|PUT /foyers/:id/parents/:parentId/preferences`. DTO/Zod. Provider Pact states. Tests.

- **PR 2 — api-gateway / BFF + OpenAPI (profil + préférences, SANS routage encore).**
  `FoyerClient.preferences()/majPreferences()`. Endpoints `GET /moi/profil`, `PUT /moi/preferences`
  (résolution parent courant + défense « seulement ma ligne »). OpenAPI hand-authored + maj test
  « N routes » + régénération `openapi-types.gen.ts`. Pact consumer enrichi.

- **PR 3 — web : page « Mon profil » (A1) + bloc Notifications.**
  Route `/mon-profil`, réutilisation `LigneParentExistant` restreint à soi, tableau type×canal,
  verrou dernier canal, validation + a11y. Types BFF (auto). Tests RTL.

- **PR 4 — svc-notifications : projection préférences + application au routage.**
  Durable `notifications-preferences` (projection idempotente). `emailsActifs(foyerId, type)` filtre
  sur préférences. Adaptation scheduler mardi + repli `NOTIF_EMAIL_PARENT` conservé. Tests
  (projection, routage, repli). **À ce stade : opt-out e-mail par écran = fonctionnel.**

- **PR 5 — désabonnement one-click (RFC 8058).**
  `MailerService` : en-têtes `List-Unsubscribe` + `List-Unsubscribe-Post`. Table
  `desabonnement_token` + génération à l'envoi. Endpoint public `POST /api/v1/desabonnement`
  (`@Public`, rate-limité, one-shot) → maj préférence + event. Page de confirmation web. Tests
  (jeton expiré/rejoué, refus dernier canal service).

- **PR 6 — inbox in-app générique (volet in-app).**
  Table `notification` (lu/non-lu) + création au canal `IN_APP`. BFF `GET /moi/notifications`,
  `POST /moi/notifications/:id/lu`. Web : cloche + compteur + panneau. Tests.

- **PR 7 — config / doc.**
  Secrets éventuels (clé de signature des jetons désabo dans `.env.server.enc`). Doc
  `docs/06-etat-davancement.md` + ADR si besoin + mémoire projet. `can-i-deploy` inchangé.

## 9. Décisions

1. ✅ **Axe A** : **A1** — page « Mon profil » ciblée sur le parent connecté, sans nouveau champ
   (_acté 2026-07-01_).
2. ✅ **Axe B** : **N3** — préférences type×canal + désabonnement RFC 8058 + inbox in-app
   (_acté 2026-07-01_).
3. ✅ **Validation hebdo** : notification de service, **canal configurable, ≥ 1 canal actif
   obligatoire** (jamais coupée totalement) — (_acté 2026-07-01_).
4. ✅ **Localisation des préférences** : **svc-foyer** (agrégat parent) + projection NATS vers
   svc-notifications (zéro nouveau Pact).
5. ✅ **Jeton de désabonnement** : **table `desabonnement_token`** (auditable RGPD, one-shot,
   révocable) — plutôt qu'un jeton auto-porteur signé sans table — (_acté 2026-07-01_).
6. ✅ **Inbox in-app** : **incluse dans le train, en dernière PR (PR 6)** — honore le choix N3
   complet ; PR la plus isolée, décalable sans bloquer le reste — (_acté 2026-07-01_).

**Toutes les décisions de cadrage sont prises → implémentation en PR phasées (§8).**

## 10. Checklist exhaustive

- [ ] contracts-foyer : id brandé, enums type/canal, event `PreferencesNotifModifiees.v1`, DTO.
- [ ] svc-foyer : tables `preference_notification` + `desabonnement_token`, migration générée,
      service (invariant ≥1 canal), controller, outbox, provider Pact, tests.
- [ ] api-gateway/BFF : `FoyerClient` préférences, endpoints `/moi/profil`, `/moi/preferences`,
      `/moi/notifications`, `/desabonnement` ; défense « seulement ma ligne ».
- [ ] OpenAPI hand-authored + maj test « N routes » + régénération `openapi-types.gen.ts` (gate drift).
- [ ] web : page `/mon-profil` (A1), bloc Notifications, verrou dernier canal, page désabo, cloche
      in-app, a11y, types, tests.
- [ ] svc-notifications : projection `preference_notification`, `emailsActifs(foyer, type)`, en-têtes
      `List-Unsubscribe`, inbox `notification`, tests idempotence/routage/désabo.
- [ ] RGPD/sécurité : consentement/désabo tracés, endpoint public durci, CASCADE, garde-fous mailer.
- [ ] Config : clé de signature jetons désabo (`.env.server.enc`), doc + mémoire projet.
- [ ] Web push : hors périmètre, `parent.id` = futur propriétaire d'abonnement.
