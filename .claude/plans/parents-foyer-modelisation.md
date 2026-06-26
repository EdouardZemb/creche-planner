# Modélisation des « parents » d'un foyer — document de conception

> Statut : **conception.** Décisions humaines prises (2026-06-26) :
> **(B) Identité / login** (§4) — les parents deviennent des identités authentifiables avec
> autorisation par foyer ; et **projection NATS** (§5) pour notifications. **Reste bloquant
> avant code : la sous-variante d'identité (B1 Cloudflare Access vs B2 auth applicative) +
> bootstrap/multi-foyer/dev — voir §4bis.** Web push **hors périmètre** mais le modèle doit
> rester compatible.

## 1. Objectif

Adresser le mail récap hebdomadaire (et, plus tard, d'autres notifications) **aux parents
du foyer concerné**, au lieu de l'unique adresse globale `NOTIF_EMAIL_PARENT`. Pour cela,
modéliser proprement des **parents** rattachés au foyer, de façon **multi-familles** et
sans rien casser de l'existant. Le parent doit aussi être le **propriétaire naturel futur**
d'un abonnement web push (sans le construire ici).

## 2. État des lieux vérifié (lecture du code)

### 2.1 Aucun modèle de parent / email aujourd'hui

- `apps/svc-foyer/src/database/schema.ts` : `foyer` = données **financières** uniquement
  (`ressources_mensuelles_centimes`, `rfr_centimes`, `nb_enfants_a_charge`, `nb_parts`,
  timestamps). `enfant` = `prenom` + `date_naissance` + FK `foyer_id` cascade. Plus une
  table `outbox`. **Aucun email, aucune notion de personne-contact.**
- Domaine `@creche-planner/foyer-domain`, contrats `@creche-planner/contracts-foyer`
  (`libs/contracts/foyer/...`) avec **branded ids** (`foyerIdSchema`, `enfantIdSchema`,
  `z.string().uuid().brand<...>()`).

### 2.2 Le récap mardi part vers une adresse GLOBALE, un mail PAR CONTRAT

- `apps/svc-notifications/src/scheduler/scheduler.hebdo.ts` :
  - boucle `for (const c of contrats)` → **un mail par contrat** (donc par enfant/mode),
    pas par foyer ;
  - `envoyerRecap()` envoie `to: this.options.emailParent`, valeur unique issue de
    `config.ts` (`email.parent` ← `NOTIF_EMAIL_PARENT`, défaut `edouard.zemb@gmail.com`).
- Garde-fou mail à **préserver** : `MailerService` (lib `@creche-planner/nest-commons`)
  applique `dryRun` (true par défaut, `NOTIF_EMAIL_DRY_RUN=false` pour activer) +
  `allowlist` (`NOTIF_EMAIL_ALLOWLIST`).

### 2.3 Le mail établissement (hors périmètre, sert de modèle)

- `apps/svc-notifications/src/envoi/envoi.service.ts` envoie `to: etab.emailService`.
- L'annuaire établissement (`etablissement_destinataire`) est **seedé au boot** puis
  éditable via `PUT /api/etablissements/:cle`. **Ne pas y toucher**, mais c'est le patron
  d'un « destinataire résolu côté notifications ».

### 2.4 Comment notifications obtient déjà ses données (décisif pour §5)

- **Projection NATS** : `apps/svc-notifications/src/consumers/jetstream.consumer.ts`
  consomme le stream `PLANIFICATION` (durable `notifications-planification`) et projette
  une table locale `contrat` (id, **foyerId**, enfant, mode, validité). Idempotence via
  table `processed_event`.
- **Client HTTP de repli** : `apps/svc-notifications/src/fallback/planification.client.ts`
  (timeout + retry + circuit-breaker) pour relire un planning à la volée.
- **Précédent fort** : `apps/svc-tarification/src/consumers/jetstream.consumer.ts`
  consomme **déjà le stream `FOYER`** (durable `tarification-foyer`) + REFERENTIEL +
  PLANIFICATION. Donc le stream `FOYER` **existe et est publié** par svc-foyer via son
  `OutboxRelay` (`libs/nest-commons/.../outbox.relay.ts`, source `svc-foyer`).
- **Pact** : svc-notifications n'a **pas** de pact _consumer_ (il ne parle à personne en
  HTTP contractuel) ; il a un pact _provider_ `api-gateway → svc-notifications`. Le seul
  consumer HTTP du système est `api-gateway`.

### 2.5 Identité / Auth aujourd'hui (CRUCIAL)

- **Aucun utilisateur, aucun login in-app.** Le « foyer actif » = un `foyerId` en
  **localStorage** (`apps/web/src/utils/store.ts`, clé `creche:foyerId`) ; `useFoyer.ts`
  charge le foyer par id.
- **Auth API = jeton partagé unique** Bearer `GATEWAY_TOKEN`
  (`apps/api-gateway/src/security/token-auth.guard.ts`) : identique pour tous, **absent →
  auth désactivée** (dev). `verifierConfigProduction` refuse le boot prod sans jeton (sauf
  `GATEWAY_AUTH_DISABLED=1`).
- **Le vrai contrôle d'accès en prod = Cloudflare Access au bord** (indices :
  `AuthExpiredError`, `erreurKind: 'session-expiree'`, commentaire « Cloudflare Access
  redirige vers sa page de connexion » dans `useFoyer.ts`).
- **Conséquence à expliciter** : il n'existe **aucune autorisation par foyer**. Quiconque
  passe Cloudflare Access et connaît/forge un `foyerId` lit ce foyer. Introduire des
  parents identifiables **soulève directement** la question de l'isolation par foyer
  (cf. fork d'identité §4).

### 2.6 Chaîne de bout en bout (gateway → web)

- BFF `apps/api-gateway/src/bff/foyers.controller.ts` : `POST /api/v1/foyers` **orchestre**
  (crée le foyer puis boucle `ajouterEnfant`) ; `GET /api/v1/foyers/:id` agrège
  `{ foyer, enfants }` = `DossierFoyerVue`. **Aucun endpoint d'édition/suppression d'enfant
  aujourd'hui** → les parents seraient la **première sous-ressource à vraie CRUD**.
- OpenAPI **écrit à la main** : `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts`
  (objet TS littéral). Gate CI **`openapi-types-drift`** : `pnpm nx run web:generate-types`
  régénère `apps/web/src/api/openapi-types.gen.ts` ; tout diff = échec. Un test
  `gateway.openapi.spec.ts` **fige le nombre exact de routes** (« expose exactement les 10
  routes attendues ») → à mettre à jour.
- Web `apps/web/src/foyer/FoyerFormPage.tsx` : liste répétable d'enfants (add / update champ
  / remove si > 1) ; conventions a11y email déjà en place dans
  `apps/web/src/etablissements/EtablissementsPage.tsx` (`type="email"`, `aria-required`,
  `aria-invalid`, `aria-describedby`, `role="alert"`).
- **Pact / can-i-deploy** : `.github/workflows/scripts/can-i-deploy.mjs`,
  `PROVIDERS_ATTENDUS = [svc-foyer, svc-referentiel, svc-planification, svc-tarification,
svc-notifications]`. Le script n'admet aujourd'hui que des paires `api-gateway →
<provider>` (un test refuse tout autre consumer). **Un nouveau consumer
  `svc-notifications → svc-foyer` (option HTTP du §5) demande de relâcher cette règle.**

## 3. Modèle de données proposé (entité `parent` dans svc-foyer)

### 3.1 Recommandation : **table dédiée `parent`**, pas des colonnes sur `foyer`

Table dédiée car : cardinalité variable (1–2 parents, parfois plus : gardes alternées,
familles recomposées), évolution future (push, rôle, consentement par personne), et symétrie
avec `enfant`. Des colonnes `email1/email2` sur `foyer` seraient un anti-pattern.

```
parent
  id           uuid PK default random
  foyer_id     uuid NOT NULL  FK -> foyer(id) ON DELETE CASCADE
  prenom       varchar(200)   NULL      -- identité douce, optionnelle
  nom          varchar(200)   NULL
  email        varchar(320)   NOT NULL  -- destinataire notification (PII)
  principal    boolean        NOT NULL default false  -- destinataire « par défaut »
  ordre        integer        NOT NULL default 0       -- ordre d'affichage stable
  actif        boolean        NOT NULL default true     -- soft-disable sans perdre l'historique
  created_at   timestamptz    NOT NULL default now()
  updated_at   timestamptz    NOT NULL default now()
  UNIQUE (foyer_id, lower(email))    -- pas deux fois le même email dans un foyer
```

Branded id `parentIdSchema = z.string().uuid().brand<'ParentId'>()` dans `contracts-foyer`.
Validation email : `z.string().email()` (Zod) à la frontière DTO.

### 3.2 Contraintes à arbitrer (proposées, à confirmer)

- **Cardinalité** : ≥ 0 en base, mais l'envoi du récap exige **≥ 1 parent actif avec email**
  (sinon repli §6). Pas de max dur (garde souple, ex. ≤ 6).
- **Unicité email** :
  - **par foyer** : oui (`UNIQUE(foyer_id, lower(email))`), évite les doublons d'envoi.
  - **globale** : **non** en option (A) contact-only — un même email peut être parent dans
    deux foyers (familles recomposées) ; **deviendrait obligatoire** en option (B) identité
    (l'email = identifiant de login → globalement unique). ⇒ **dépend du fork §4.**
- **`principal`** : au plus un `principal` par foyer (contrainte partielle
  `UNIQUE(foyer_id) WHERE principal`). Utile si on veut un destinataire « À » et les autres
  en « Cc », ou pour un futur affichage.
- **Consentement / RGPD** : champ `consentement_at timestamptz NULL` envisageable si on veut
  tracer l'opt-in ; sinon la base légale = intérêt légitime du service rendu (à acter §7).

### 3.3 Migration **générée** (jamais à la main)

- `drizzle.config.ts` de svc-foyer → `pnpm drizzle-kit generate` produit le `.sql` +
  `meta/_journal.json` + snapshot dans `apps/svc-foyer/src/database/migrations/`.
- **Piège connu** : drizzle-kit exige un **TTY** pour arbitrer _drop-vs-rename_ sur une
  colonne ambiguë. Ici on **ajoute une table neuve** → pas d'arbitrage attendu, mais
  **scinder** la PR si une autre modif ambiguë coexiste. Ne jamais éditer le SQL à la main.

### 3.4 Événement domaine (outbox) — pour §5 option NATS

Émettre `foyer.ParentAjoute.v1` (et, si édition, `foyer.ParentModifie.v1` /
`foyer.ParentRetire.v1`) dans la **même transaction** que l'écriture, via l'`OutboxRelay`
existant → publié sur le stream `FOYER` déjà consommé par tarification. Payload :
`{ foyerId, parentId, email, prenom?, nom?, principal, actif }`. **PII dans l'événement** :
acceptable (flux interne chiffré au repos selon §7) mais à mentionner.

## 4. ⚠️ LE FORK D'IDENTITÉ — à trancher avant de coder

L'introduction de parents identifiables (avec email) **touche directement** au point
faible §2.5 : il n'y a aucune isolation par foyer. Deux directions, conséquences en cascade.

### Option (A) — Contact-only _(recommandée pour démarrer)_

Les emails parents ne sont **que des destinataires de notification**. **Aucun login.** On
garde le modèle actuel : Cloudflare Access au bord + jeton partagé + `foyerId` localStorage.

| Axe                          | Conséquence                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**                     | Inchangée. `TokenAuthGuard` et `GATEWAY_TOKEN` intacts.                                                                                                                      |
| **Autorisation / isolation** | **Toujours aucune** isolation par foyer. Risque résiduel identique à aujourd'hui (Cloudflare Access reste la seule barrière). On ne **dégrade pas**, mais on n'améliore pas. |
| **Web**                      | Ajout d'un bloc « Parents » dans le formulaire foyer (liste répétable d'emails). Sélection du foyer inchangée (localStorage).                                                |
| **Cloudflare Access**        | Inchangé.                                                                                                                                                                    |
| **Migration données**        | Aucune migration d'identité. Repli `NOTIF_EMAIL_PARENT` tant qu'un foyer n'a pas de parent (§6).                                                                             |
| **Web push (futur)**         | **Compatible** : un abonnement push se rattachera à `parent.id`.                                                                                                             |
| **Coût**                     | **Faible** — 1 à 4 PR (§8, jusqu'à phase web).                                                                                                                               |

**Limite explicite** : (A) **n'apporte aucune isolation par foyer**. Un email parent n'est
pas une preuve d'identité ; ce n'est qu'une adresse d'envoi.

### Option (B) — Identité / login (autorisation par foyer)

Les parents deviennent des **identités authentifiables** mappées à leur foyer, avec
**autorisation par foyer** (un parent ne voit que SON foyer).

| Axe                          | Conséquence                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth**                     | Remplacer/compléter le jeton partagé par une vraie authn. Deux sous-variantes : **(B1)** s'appuyer sur **Cloudflare Access** (l'identité = email vérifié par CF, header `Cf-Access-Authenticated-User-Email` / JWT) → mapper `email → parent → foyer` ; **(B2)** auth applicative complète (magic-link / OIDC) — chantier bien plus lourd. |
| **Autorisation / isolation** | **Sécuriser TOUTES les routes par foyer** : le BFF doit dériver le `foyerId` autorisé depuis l'identité, plus depuis le client. `TokenAuthGuard` devient un guard d'identité + un guard d'appartenance au foyer sur chaque route `/foyers/:id`, `/contrats?foyer=`, etc.                                                                   |
| **Web**                      | Abandonner le `foyerId` localStorage **comme source de vérité** : le foyer découle de l'identité (résolu serveur). Gérer le cas « email connu de plusieurs foyers » et « zéro foyer ».                                                                                                                                                     |
| **Cloudflare Access**        | En (B1), CF devient fournisseur d'identité de confiance ; il faut **propager l'email vérifié** jusqu'au BFF et l'y faire confiance (et le bloquer si la requête ne vient pas de CF).                                                                                                                                                       |
| **Migration données**        | Back-fill : associer les foyers existants à des emails parents ; gérer les foyers orphelins. Email **globalement unique** requis.                                                                                                                                                                                                          |
| **Web push (futur)**         | Compatible également (push lié au parent authentifié).                                                                                                                                                                                                                                                                                     |
| **Coût**                     | **Élevé, transverse** : guards, propagation d'identité BFF→services, mise à jour Pact/OpenAPI, refonte sélection foyer web, tests d'autorisation à toutes les couches. Plusieurs PR additionnelles, risque de régression d'accès.                                                                                                          |

### Recommandation

**Démarrer en (A) contact-only**, avec un **modèle conçu pour ne pas empêcher (B)** :

- table `parent` avec `email` déjà présent (deviendra l'identifiant en B) ;
- garder l'option d'ajouter `UNIQUE(lower(email))` global + une table `parent_identite` /
  colonnes d'auth plus tard, sans casser l'existant ;
- ne pas coupler le code notifications à un quelconque login.

Rationale : l'objectif immédiat (router le récap vers les bons parents) est **atteint en (A)**
sans ouvrir le chantier d'autorisation. (B) est un projet de sécurité à part entière, à
décider sciemment quand l'isolation par foyer devient une exigence (multi-clients réels).
**Mais c'est une décision produit/sécurité : à l'humain de trancher.**

## 4bis. Conception de l'option (B) retenue — identité / autorisation par foyer

> **Décision actée : (B).** Cette section détaille ce que (B) implique **réellement**, sans
> rien omettre de l'impact auth, et fait émerger la sous-décision **B1 vs B2** + 3 points de
> conception (bootstrap, multi-foyer, dev local) à confirmer avant code.

### 4bis.1 Deux modèles de l'identité d'un parent (sous-fork bloquant)

L'email parent du §3 devient un **identifiant de connexion** → `UNIQUE(lower(email))`
**global** (et plus seulement par foyer). Reste à décider **qui prouve cette identité** :

|                     | **(B1) Confiance Cloudflare Access** _(recommandé)_                                                                                                                                                                                                 | **(B2) Auth applicative**                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Principe**        | CF Access authentifie déjà l'humain au bord (il « redirige vers sa page de connexion », cf. `useFoyer.ts`). On **fait confiance à l'email vérifié par CF** et on mappe `email → parent → foyer`.                                                    | Construire une vraie authn dans l'app (magic-link e-mail / OIDC), sessions, etc.                              |
| **Ce qu'on ajoute** | Au BFF : **valider le JWT `Cf-Access-Jwt-Assertion`** (signature contre les clés publiques du team domain + `aud` de l'application) — **ne jamais faire confiance au header email brut, spoofable**. En extraire l'email → résoudre le(s) foyer(s). | Fournisseur d'identité, stockage de sessions/tokens, flux magic-link, templates, anti-bruteforce, révocation… |
| **Couplage**        | Dépend de CF Access en prod (déjà le cas de fait).                                                                                                                                                                                                  | Indépendant de CF, mais **redondant** avec lui.                                                               |
| **Coût**            | Modéré : un guard d'identité + un guard d'appartenance au foyer.                                                                                                                                                                                    | **Élevé** : sous-système d'auth complet à bâtir, maintenir, sécuriser.                                        |
| **Risque**          | Bien cadré (validation JWT standard).                                                                                                                                                                                                               | Surface d'attaque et dette nouvelles.                                                                         |

**Recommandation : (B1).** CF Access est déjà la barrière réelle ; (B2) réinvente une roue
existante. (B1) transforme « CF a laissé passer quelqu'un » en « **ce parent précis**, donc
**ces foyers** » — c'est exactement l'isolation visée, à moindre coût.

### 4bis.2 Architecture d'autorisation (commune B1/B2, illustrée pour B1)

1. **Au bord (prod)** : Cloudflare Access devant la gateway (déjà en place). En **B1**, CF
   injecte `Cf-Access-Jwt-Assertion` (JWT signé) + l'email vérifié.
2. **Gateway — guard d'identité** : remplace/complète `TokenAuthGuard`. Il **valide le JWT
   CF** (issuer = team domain, `aud` = app, signature via JWKS CF), extrait `email`, et le
   pose en `request.identite = { email }`. _Le jeton partagé `GATEWAY_TOKEN` reste possible
   pour l'auth **machine** web→gateway, mais l'**autorisation** ne s'en déduit plus._
3. **Gateway — résolution foyer** : appel à svc-foyer `GET /foyers?parentEmail=…` →
   liste des `foyerId` dont l'email est parent **actif**.
4. **Gateway — guard d'appartenance** : sur **toute** route portant un `foyerId`
   (`/foyers/:id`, `/foyers/:id/*`, `/contrats?foyer=`, `/couts?foyer=`, plannings…),
   refuser (403) si le `foyerId` demandé n'est pas dans l'ensemble autorisé de l'identité.
   ⇒ **inventaire exhaustif des routes portant un foyerId** à sécuriser (livrable de la PR).
5. **Services aval** : restent derrière la gateway (réseau privé). On **ne propage pas** une
   identité jusqu'à svc-foyer/planification dans un premier temps : l'autorisation est
   centralisée au BFF (point d'entrée unique). _(Si un jour les services sont exposés
   directement, il faudra propager — hors périmètre ici, à noter.)_

### 4bis.3 Bootstrap (œuf-poule) — **décidé : (b-ii) provisioning admin**

Un foyer neuf n'a encore **aucun parent** → on ne peut pas « autoriser par foyer » sa
création. **Décision actée : (b-ii) provisioning admin** — seul un **rôle admin** crée les
foyers et y rattache les emails parents.

Conséquences de (b-ii) à intégrer :

- **Notion d'admin** à introduire. Mécanisme recommandé (cohérent avec le style env du
  repo + B1) : **allowlist d'emails admin** (`ADMIN_EMAILS`, CSV chiffré dans
  `.env.server.enc`) comparée à l'**email vérifié par CF Access**. Pas de table de rôles ni
  d'écran de gestion des droits dans un premier temps. _(Alternative : groupe Cloudflare
  Access — à étudier si CF expose les groupes dans le JWT ; sinon allowlist env.)_
- **L'écran web « créer un foyer » actuel devient réservé admin** (gate sur identité admin).
  Les parents non-admin n'ont **pas** de flux de création self-service.
- **Endpoints d'administration** : créer un foyer + attacher/détacher des parents
  (réutilise la CRUD parents de svc-foyer, mais **gated admin** au BFF).
- Le **back-fill** initial (foyers existants → emails parents) est lui aussi une **action
  admin** (script/outil), ce qui colle bien avec (b-ii).
- Surcoût vs (b-i) : un **guard admin** au BFF + le gating de l'écran de création. Pas de
  self-service onboarding à concevoir (plus simple côté UX parent : un parent non rattaché
  voit un écran « contactez l'administrateur », cf. cardinalité 0 du §4bis.4).

### 4bis.4 Cardinalité identité↔foyer — à confirmer

Un email peut être parent de **0, 1 ou N foyers** (familles recomposées, multi-clients) :

- **0** : onboarding (cf. bootstrap) ou « pas encore invité » → écran dédié.
- **1** : cas nominal → le foyer découle de l'identité (plus besoin du localStorage comme
  **source de vérité**, on peut le garder comme simple cache d'UX).
- **N** : sélecteur de foyer côté web, **borné à l'ensemble autorisé** (et non plus un id
  libre en localStorage). Le `foyerId` localStorage devient un **choix dans une liste
  autorisée**, plus une clé forgáble.

### 4bis.5 Dev / local (pas de Cloudflare Access) — à confirmer

En local, pas de CF. Prévoir une **identité de dev injectable** sans trou de sécurité prod :

- header de dev `X-Dev-User-Email` accepté **uniquement** si `GATEWAY_AUTH_DISABLED=1` /
  `NODE_ENV!=production`, défaut « tous foyers » sinon une valeur d'env. Le garde-fou
  `verifierConfigProduction` interdit déjà ce mode en prod sans opt-in explicite — on étend
  la même philosophie à l'identité (refuser le boot prod si la validation JWT CF n'est pas
  configurée, sauf opt-out explicite et tracé).

### 4bis.6 Conséquence sur le modèle de données (§3 amendé pour B)

- `email` du parent : `UNIQUE(lower(email))` **global** (identité de login).
- Option : table `parent` suffit (l'email EST l'identité, pas de mot de passe en B1). Pas de
  `parent_identite` séparée tant qu'on reste B1. En B2, ajouter le stockage d'auth.
- `foyer ←→ parent` reste 1-N (un foyer a des parents) ; l'« identité » est l'email, qui peut
  apparaître dans plusieurs foyers → la **résolution** `email → {foyerId}` est un `SELECT`
  multi-lignes (d'où la cardinalité N du §4bis.4).

### 4bis.7 Impacts auth additionnels — checklist (ne rien omettre)

- [ ] Guard d'identité (validation JWT CF en B1, ou sessions en B2) remplaçant/complétant
      `TokenAuthGuard`.
- [ ] Guard d'appartenance au foyer sur **toutes** les routes portant un foyerId
      (inventaire exhaustif à produire).
- [ ] Endpoint svc-foyer `GET /foyers?parentEmail=…` (+ provider Pact state) pour la
      résolution identité→foyers.
- [ ] Flux bootstrap (création de foyer auto-liée au 1er parent).
- [ ] Web : sélection du foyer bornée à l'ensemble autorisé ; gestion 0 / 1 / N foyers ;
      localStorage rétrogradé en cache.
- [ ] Cloudflare Access : config team domain / `aud` / JWKS ; documentation ; refus si la
      requête ne provient pas de CF en prod.
- [ ] Mode dev sans CF (identité injectable, verrouillée hors prod).
- [ ] Migration : back-fill des foyers existants avec un email parent (sinon foyers
      inaccessibles) ; email globalement unique.
- [ ] Tests d'autorisation (accès refusé cross-foyer) à chaque couche.
- [ ] **Déploiement progressif** : guard d'appartenance **derrière un flag**, activé après
      back-fill, pour ne jamais verrouiller la prod par accident.

## 5. Mode d'accès notifications → emails des parents

Il faut que svc-notifications connaisse les emails parents d'un `foyerId` au moment d'envoyer
le récap. Deux options ; **précédent du repo = projection NATS** (§2.4).

### Option NATS — projection locale _(recommandée)_

- svc-notifications **s'abonne au stream `FOYER`** (nouveau durable
  `notifications-foyer`) et projette une table locale `foyer_parent`
  (`foyer_id, parent_id, email, principal, actif`), alimentée par
  `foyer.ParentAjoute/Modifie/Retire.v1`. Idempotence via `processed_event` (déjà en place).
- **Avantages** : découplage runtime (le job du mardi ne dépend pas de la disponibilité de
  svc-foyer), cohérent avec `contrat` (déjà projeté) et avec tarification (déjà abonné à
  `FOYER`), **pas de nouveau Pact**.
- **Inconvénients** : cohérence éventuelle (un parent ajouté juste avant le mardi pourrait ne
  pas être encore projeté — acceptable pour un récap hebdo) ; nécessite que svc-foyer
  **émette** les événements parent.

### Option HTTP — appel direct + Pact

- Nouveau client `FoyerClient` dans svc-notifications (`GET /api/foyers/:id/parents`),
  pattern du `planification.client.ts` (timeout/retry/breaker).
- **Coût Pact** : crée une **nouvelle paire `svc-notifications → svc-foyer`**, ce que le
  `can-i-deploy.mjs` **rejette aujourd'hui** (seul `api-gateway` est consumer). Il faut
  modifier le script + `PROVIDERS_ATTENDUS`/règles, ajouter un provider state svc-foyer, un
  pact consumer côté notifications. **Couplage runtime** sur le job du mardi.

### Recommandation

**Projection NATS.** Plus idiomatique ici, zéro nouveau contrat Pact, découple l'envoi.
Le surcoût (table projetée + consumer) est faible et parfaitement balisé par l'existant.
_(À confirmer : c'est l'autre vrai fork architectural.)_

## 6. Regroupement du récap : 1 mail aux parents par foyer (au lieu d'1 par contrat)

- Aujourd'hui : `for (const c of contrats)` → un mail par contrat. Cible : **agréger par
  `foyerId`**, envoyer **un** mail aux parents du foyer, listant les enfants/contrats
  concernés de la semaine (le template `recapMardi` est à adapter pour accepter une liste).
- `to:` = emails des parents **actifs** du foyer (projection §5). `to` multi-destinataires
  (ou principal en `to`, autres en `cc` — décision mineure, défaut : tous en `to`).
- **Repli `NOTIF_EMAIL_PARENT`** (dépréciation progressive) : si un foyer n'a **aucun**
  parent avec email, envoyer à l'adresse globale + **journaliser un warning** (et garder la
  variable d'env tant que tous les foyers ne sont pas peuplés). Documenter la dépréciation.
- L'**idempotence exactly-once** (`notification_hebdo` UNIQUE) reste **par contrat** (ne pas
  casser le Lot 5) ; seul **l'envoi** est regroupé : on fige les lignes par contrat, puis on
  envoie **un** mail par foyer pour les contrats fraîchement notifiés.

## 7. RGPD / sécurité (emails = PII)

- **Isolation cross-foyer** : `UNIQUE(foyer_id, lower(email))` + CASCADE ; en option (A),
  rappeler que l'isolation d'**accès** reste assurée seulement par Cloudflare Access.
- **Chiffrement at-rest** : la base svc-foyer tourne en Postgres dans Compose ; le repo a
  déjà une discipline secrets (sops/age, doc 29). Décision à acter : chiffrement applicatif
  des emails (probablement **non** — surdimensionné ; s'appuyer sur le chiffrement disque /
  accès restreint), mais **le documenter**.
- **Rétention** : suppression du foyer → CASCADE supprime parents (droit à l'effacement de
  base). Prévoir un endpoint de retrait de parent (soft `actif=false` + hard delete possible).
- **Garde-fou mailer préservé** : `dryRun` + `allowlist` continuent de s'appliquer (un
  déploiement mal configuré ne spammera pas de vrais parents).

## 8. Découpage en PR phasées (1 phase = 1 PR, CI verte à chaque étape)

> Ordre pour **(B1) + NATS**. Principe directeur : **le modèle et les destinataires d'abord
> (sans risque), l'enforcement d'autorisation EN DERNIER et derrière un flag** — pour ne
> jamais verrouiller la prod avant d'avoir back-fillé les emails parents.

- **PR 1 — svc-foyer : modèle parent + CRUD + événements + résolution.**
  Contrats (`contracts-foyer` : `parentIdSchema`, events `ParentAjoute/Modifie/Retire.v1`).
  Schéma drizzle `parent` (`UNIQUE(lower(email))` **global**) + **migration générée**.
  Service (`ajouterParent`/`lister`/`modifier`/`retirer` transactionnels + outbox) +
  **résolution `foyersParEmail(email)`**. Controller `POST|GET|PUT|DELETE
/foyers/:id/parents[/:parentId]` **+ `GET /foyers?parentEmail=…`**. DTO/Zod. Provider Pact
  states. Tests. _Pièges CI : `nx build` avant typecheck (`TS6305`), provider Pact Postgres._

- **PR 2 — api-gateway / BFF + OpenAPI (CRUD parents, SANS enforcement).**
  `FoyerClient.parents()/ajouterParent()/…` + `foyersParEmail()`. `DossierFoyerVue.parents`.
  Endpoints BFF (orchestration création + CRUD). **OpenAPI hand-authored** (schéma
  `ParentVue`, routes, **maj test « N routes »**) + régénération `openapi-types.gen.ts` →
  gate `openapi-types-drift`. Pact consumer api-gateway→svc-foyer enrichi.

- **PR 3 — web : UI parents.**
  Bloc « Parents » dans `FoyerFormPage` (liste répétable email + identité, add/edit/remove,
  validation email, a11y comme `EtablissementsPage`). Types BFF (auto). Tests RTL.

- **PR 4 — svc-notifications : projection NATS + envoi groupé.**
  Schéma local `foyer_parent` + migration. Consumer durable `notifications-foyer` sur stream
  `FOYER` (projection idempotente via `processed_event`). Résolution destinataires par foyer.
  **Récap groupé par foyer** + adaptation `recapMardi`. **Repli `NOTIF_EMAIL_PARENT`** +
  warning. Tests (projection, scheduler groupé, repli). _Garde-fous mailer intacts._

  > **À ce stade, l'objectif fonctionnel (mail aux parents) est ATTEINT, sans toucher à
  > l'auth.** Les PR 5–7 ajoutent l'isolation par foyer (le cœur de l'option B).

- **PR 5 — identité au BFF (guard d'identité B1, observe-only).**
  Validation JWT Cloudflare Access (JWKS/team domain/`aud`) → `request.identite.email`.
  Mode dev injectable verrouillé hors prod. **N'autorise/ne refuse encore RIEN** : pose
  l'identité + journalise (« aurait refusé X »). `verifierConfigProduction` étendu.

- **PR 6 — admin (provisioning) + sélection foyer web (toujours sans refus dur).**
  **Guard admin** au BFF (allowlist `ADMIN_EMAILS` vs email CF). Écran « créer un foyer »
  **gated admin** + rattachement/détachement des parents (admin). Web côté parent : sélecteur
  borné à l'ensemble autorisé (0/1/N foyers), écran « contactez l'administrateur » si 0 ;
  localStorage rétrogradé en cache. **Back-fill admin** des foyers existants (script
  documenté).

- **PR 7 — enforcement de l'autorisation par foyer (derrière flag).**
  Guard d'appartenance 403 sur **toutes** les routes portant un `foyerId` (inventaire
  exhaustif ; admin bypass). Activé par flag **après** back-fill vérifié. Tests d'accès
  refusé cross-foyer à chaque couche.

- **PR 8 — config / déploiement / doc.**
  Dépréciation `NOTIF_EMAIL_PARENT`. Config CF Access (team domain/`aud`) + `ADMIN_EMAILS` +
  secrets `.env.server.enc` / staging. `docs/06-etat-davancement.md` + mémoire projet.
  `can-i-deploy` inchangé (option NATS → pas de nouvelle paire).

## 9. Décisions

1. ✅ **Fork d'identité (§4)** : **(B) identité / login** — _acté 2026-06-26._
2. ✅ **Accès notifications→parents (§5)** : **projection NATS** — _acté 2026-06-26._
3. ✅ _(déduit de B)_ unicité email **globale**.
4. ✅ **Sous-variante d'identité (§4bis.1)** : **(B1) Cloudflare Access** — _acté 2026-06-26._
5. ✅ **Bootstrap (§4bis.3)** : **(b-ii) provisioning admin** (allowlist `ADMIN_EMAILS`) —
   _acté 2026-06-26._

**Toutes les décisions de cadrage sont prises → implémentation en PR phasées (§8).**

## 10. Impacts exhaustifs — checklist (pour ne rien oublier)

- [ ] svc-foyer : schéma `parent` + migration générée + service + controller + DTO/Zod +
      events outbox + provider Pact + tests.
- [ ] contracts-foyer : `parentIdSchema`, schémas d'événements + payloads.
- [ ] api-gateway/BFF : `FoyerClient`, `DossierFoyerVue.parents`, endpoints CRUD,
      orchestration création.
- [ ] OpenAPI hand-authored (`gateway.openapi.ts`) + régénération `openapi-types.gen.ts` +
      maj test « N routes » → gate `openapi-types-drift`.
- [ ] web : UI parents (formulaire foyer), validation, a11y, types, tests.
- [ ] svc-notifications : projection `foyer_parent` (NATS) **ou** client HTTP (Pact),
      résolution destinataires, **récap groupé par foyer**, repli `NOTIF_EMAIL_PARENT`.
- [ ] Config/déploiement : dépréciation `NOTIF_EMAIL_PARENT`, env/secrets `.env.server.enc`,
      staging.
- [ ] Pact / can-i-deploy : provider states svc-foyer (toujours) ; nouvelle paire
      notifications↔foyer **seulement si option HTTP** (+ `PROVIDERS_ATTENDUS`/script).
- [ ] RGPD/sécurité : isolation cross-foyer, rétention/CASCADE, position chiffrement,
      garde-fous mailer.
- [ ] Tests à chaque couche + `docs/06-etat-davancement.md` + mémoire projet.
- [ ] Web push : **hors périmètre**, mais `parent.id` = futur propriétaire de l'abonnement.
