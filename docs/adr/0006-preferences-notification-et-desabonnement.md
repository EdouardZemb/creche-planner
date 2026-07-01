# ADR-0006 — Préférences de notification dans svc-foyer + désabonnement one-click (RFC 8058)

- **Statut** : Accepté
- **Date** : 2026-07-01
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0001](0001-architecture-microservices.md) (microservices stricts),
  [ADR-0004](0004-decentralisation-des-contrats.md) (décentralisation des contrats),
  [ADR-0005](0005-registre-de-contrats.md) (pacts fichiers + garde `can-i-deploy`).
- **Déclencheur** : plan de conception `.claude/plans/parent-profil-notifications.md` (feature
  « profil parent self-service + préférences de notification », axes A1 + N3), livrée en 7 PR
  (`#119`→PR7). Rappel du contexte : l'auth CF Access (identité parent B1) et les parents
  identifiables sont **déjà en prod** (feature « parents du foyer », ADR implicite du plan
  `parents-foyer-modelisation.md`).

## Contexte

La feature ajoute deux capacités liées :

1. **Des préférences de notification par parent**, matricées `type × canal`
   (`VALIDATION_HEBDO`/`RECAP_SERVICE` × `EMAIL`/`IN_APP`/futur `PUSH`), pilotant qui reçoit quoi et
   par quel canal — avec un **invariant de service** : une notification transactionnelle
   (`VALIDATION_HEBDO`) reste toujours joignable par **au moins un canal** (jamais coupée
   totalement).
2. **Un désabonnement conforme** : droit d'opposition RGPD exposé à la fois par un écran
   (« Mon profil ») et par un **lien one-click** dans chaque e-mail, sans login.

Deux questions d'architecture devaient être tranchées et figées :

- **Où vivent les préférences ?** Le `parent` est un agrégat de **svc-foyer**. svc-notifications
  n'en est qu'un **consommateur** (projection NATS locale `foyer_parent`, alimentée par les events
  du stream `FOYER`). Placer les préférences ailleurs (p. ex. dans svc-notifications, ou dans un
  nouveau service « préférences ») créerait soit une **écriture inter-service** (nouvelle paire
  Pact gateway↔service, cf. [ADR-0005](0005-registre-de-contrats.md)), soit une source de vérité
  dupliquée.
- **Comment matérialiser le jeton de désabonnement one-click ?** L'endpoint est **public**
  (`@Public`, hors `IdentiteGuard`/`FoyerScope`) : il doit prouver l'intention sans session. Deux
  options — un jeton **auto-porteur signé sans état** (révoqué seulement par rotation de secret),
  ou un jeton **adossé à une table** (auditable, one-shot, révocable).

## Décision

**1. Les préférences vivent dans svc-foyer (agrégat propriétaire du parent), projetées vers
svc-notifications par événement — zéro nouveau Pact.**

- Table dédiée `preference_notification` dans svc-foyer (cardinalité `type × canal` variable,
  extensible sans migration par type — même raisonnement que « table `parent` plutôt que
  `email1/email2` »). L'**absence de ligne** vaut **défaut applicatif** → migration purement
  additive, pas de back-fill.
- Écriture transactionnelle (`majPreferences` + outbox dans la **même transaction**), émettant
  `foyer.PreferencesNotifModifiees.v1` — **état complet** des préférences du parent (le consommateur
  projette sans relire). Invariant « ≥ 1 canal actif » pour un type de service refusé côté service
  (400) **et** verrouillé côté écran.
- svc-notifications **projette** cet event dans une table locale `preference_notification` (durable
  sur le stream `FOYER` existant, idempotence `processed_event`) et filtre les destinataires
  (`emailsActifs(foyerId, type)`) : un parent ayant coupé l'e-mail n'apparaît plus comme
  destinataire e-mail (mais reçoit l'in-app). Le repli `NOTIF_EMAIL_PARENT` ne joue que si **aucun**
  parent n'a d'e-mail actif (comportement historique préservé).
- **Conséquence contrats** : svc-notifications reste un **pur consommateur/projection** ⇒ **aucune
  nouvelle paire consommateur→provider**, la matrice `PROVIDERS_ATTENDUS` de `can-i-deploy.mjs` est
  **inchangée** (cf. [ADR-0005](0005-registre-de-contrats.md)). Seuls les provider states de
  svc-foyer sont enrichis. Le BFF `PUT /moi/preferences` s'appuie sur les endpoints svc-foyer
  existants (`/foyers/:id/parents/:parentId/preferences`) sous l'isolation `@FoyerScope` déjà en
  place.

**2. Le désabonnement one-click est conforme RFC 8058, avec un jeton adossé à une table
(`desabonnement_token`) — one-shot, expirant, auditable.**

- Chaque e-mail de récap parent porte les en-têtes `List-Unsubscribe` (URL HTTPS + `mailto:`
  optionnel) et `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), permettant au client
  de messagerie de désabonner l'adresse par un **POST direct** — jamais un GET (les prefetchers ne
  doivent pas déclencher l'action).
- Le jeton est **signé HMAC** (`node:crypto`, pas de dépendance) et ne porte que `jti` + `exp` ; les
  métadonnées (`parent`, `type`, `canal`) vivent en base dans `desabonnement_token`. La
  consommation est **atomique et one-shot** (`utilise_le IS NULL` returning), pose `desabonne_at` +
  `actif=false` et émet `PreferencesNotifModifiees.v1` **dans la même transaction**. Refus **409**
  sans consommer si l'on tenterait de couper le **dernier canal** d'un type de service.
- **Pourquoi la table plutôt qu'un jeton auto-porteur sans état** : (a) **audit RGPD** — preuve
  horodatée du désabonnement ; (b) **usage one-shot** réel (un jeton auto-porteur reste rejouable
  jusqu'à expiration) ; (c) **révocabilité** fine sans rotation globale de secret. Le coût — une
  écriture/lecture en base — est négligeable au volume visé.
- **Durcissement** de l'endpoint public : jeton opaque signé/expirant/one-shot, **rate-limité**
  (guard existant), erreurs **génériques** (aucune énumération, aucune fuite d'existence de compte).
  Le récap **au service** (sortant vers l'établissement) n'est **pas** une communication _au parent_
  et n'est donc **pas** désabonnable côté parent — documenté.

## Configuration & secrets (PR7)

- **`DESABONNEMENT_TOKEN_SECRET`** (svc-foyer) signe les jetons. **Requis en prod**
  (`docker-compose.server.yml` le passe en `${DESABONNEMENT_TOKEN_SECRET:?}`) : un secret vide/faible
  rendrait les jetons **forgeables**. Comme `PG_NOTIFICATIONS_PWD` (Lot 7), il doit être ajouté à
  `.env.server` **puis** `.env.server.enc` (sops+age, cf.
  [doc 29](../exploitation/29-rotation-secrets.md)) **avant** le train de release qui embarque la
  feature — sinon `docker compose config` échoue et le déploiement est refusé (fail hard idiomatique,
  cf. [ADR-0003](0003-decisions-de-toolchain.md)). Le défaut de dev de `config.ts` n'est jamais un
  secret de prod.
- **`NOTIF_PUBLIC_API_URL`** (= origine publique) et **`FOYER_URL`** (= `http://svc-foyer:3002`,
  interne) câblent respectivement la cible one-click des e-mails et la frappe des jetons par
  svc-notifications. `NOTIF_UNSUBSCRIBE_MAILTO` (optionnel) ajoute le repli `mailto:`.
- Le CI `config-validation` reçoit une valeur **factice** `DESABONNEMENT_TOKEN_SECRET=ci` (valide la
  **structure** du merge Compose, jamais un vrai secret).

## Conséquences

**Bénéfices :**

- **Aucun nouveau contrat Pact** : la garde `can-i-deploy` reste inchangée ; svc-notifications ne
  gagne aucune dépendance synchrone d'écriture. La cohérence est portée par l'event `FOYER`.
- **Opt-out fonctionnel et conforme** : l'écran et le lien one-click satisfont le droit d'opposition
  RGPD ; le jeton en table fournit la preuve d'audit et l'usage unique.
- **Invariant de service garanti** : une notification transactionnelle ne peut jamais devenir
  totalement injoignable (verrou écran + refus 400 service + refus 409 dernier canal au
  désabonnement).
- **Garde-fous mailer intacts** : `dryRun`/`allowlist`/repli `NOTIF_EMAIL_PARENT` inchangés — un
  mauvais déploiement ne spamme pas.

**Limites assumées :**

- L'event `PreferencesNotifModifiees.v1` transporte de la **PII** (`parentId` + préférences) sur le
  stream interne — position inchangée vs. la feature parents (flux interne, chiffrement at-rest
  disque). À ré-évaluer si le bus devait sortir du périmètre de confiance.
- Le désabonnement one-click agit sur **un** canal d'**un** type ; il ne « désabonne de tout » pas —
  choix délibéré (invariant de service). L'utilisateur gère le reste via l'écran.

## Révision

Réversible et incrémental. Un futur canal (`PUSH`) s'ajoute par une valeur d'enum + une ligne de
projection, sans changer cette architecture. Si un vrai Pact Broker était introduit
([ADR-0005](0005-registre-de-contrats.md) §Révision), la décision « zéro paire ajoutée » resterait
vraie (svc-notifications demeure consommateur). Le passage à un jeton auto-porteur (si l'audit RGPD
n'était plus requis) ne toucherait que svc-foyer.
