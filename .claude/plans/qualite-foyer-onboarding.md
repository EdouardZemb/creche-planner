# Plan — Palier qualité « Ma famille » (foyer + onboarding)

> **Statut** : validé PO (2026-07-11). Périmètre : le cycle de vie du foyer (création/onboarding,
> édition, enfants, parents) du tap parent jusqu'à la base et aux projections NATS.
> **Exécutant** : Opus 4.8 (routage par lot indiqué). **1 lot = 1 PR**, main protégée → PR + check `ci`.

---

## 1. Contexte et objectif

Le parcours « Mon foyer » (création, édition, enfants, parents) est le **seul grand pan de l'app
jamais passé au crible qualité** — et c'est le tout premier contact d'un nouveau parent
(identifié par Cloudflare Access). L'audit (2026-07-11) a établi :

**Côté parent (front)** :

- Supprimer un enfant = **hard delete en un tap sans confirmation** (`ModaleConfirmation` existe et
  est utilisée pour les contrats, pas ici). Idem « Retirer » un parent.
- **Auto-verrouillage possible** : un parent peut retirer tous les parents (lui compris) ou changer
  son propre e-mail → `foyersParEmail` ne le trouve plus → plus personne ne peut éditer le foyer.
  `FOYER_AUTHZ_ENFORCE=1` est **actif en prod** : le risque est réel.
- Message à l'écran **factuellement faux** (`EnfantsSection.tsx:36`) : « renommer un enfant
  n'affecte pas les contrats » — faux depuis `contrat.enfantId` (le renommage se propage via
  `foyer.EnfantModifie` → projection svc-planification).
- **Bug de fraîcheur** : `MoiContext` ne se recharge jamais → après la 1ʳᵉ création, revenir à
  l'accueil réaffiche « Vous n'avez pas encore de foyer ».
- Onboarding sans guidage : le formulaire de création ouvre sur le fiscal (RFR, parts) sans
  explication ; le dashboard d'un foyer neuf ne renvoie pas vers la création de contrat.
- Aucun feedback de succès sur les écritures parents/enfants ; éditer les ressources éjecte vers
  le planning (même « Annuler ») ; styles inline partout ; cases à cocher < 44 px.

**Côté système (backend)** :

- Index unique **global** `lower(email)` sur `parent` : contredit le modèle multi-foyers, et le
  soft-delete d'un parent **bloque son e-mail à jamais** (409 au ré-ajout, aucune réactivation).
- Création de foyer **non atomique** : le BFF enchaîne foyer → enfants → parents en appels HTTP
  séparés sans compensation → dossier à moitié créé possible. La règle « le créateur devient
  parent » vit dans la gateway (`parentsAvecCreateur`), pas dans svc-foyer.
- Aucune garde « dernier parent actif » côté service.
- `relayer` (BFF) **masque les corps d'erreur amont** (`detail: 'HTTP 409'`) → le front ne peut pas
  distinguer « e-mail déjà pris » / « principal déjà existant » / (futur) « dernier parent ».
- `GET /api/v1/foyers` liste tout sans scope ; `@CreationFoyerUnique` est fail-open si svc-foyer
  est indisponible.
- Pact : chemins nominaux seulement (aucun 404/409, `?parentEmail=` non couvert).

**À préserver (déjà bon)** : outbox transactionnel (état + événement dans la même transaction),
consommateurs NATS idempotents (`processed_event`), validation Zod double barrière
(HTTP + domaine), messages d'erreur front déjà en français (`utils/erreurs.ts`).

## 2. Décisions validées par le PO

1. **5 lots, dans cet ordre** : gestes destructifs sûrs → création atomique → onboarding guidé →
   cohérence de l'écran d'édition + langage → intégrité & contrats.
2. **Unicité e-mail parent : par foyer, parents actifs seulement** — index partiel
   `(foyer_id, lower(email)) WHERE actif`. Débloque la réactivation après retrait ET les familles
   recomposées (un e-mail parent de deux foyers).
3. **Langage : « ma famille »** remplace « foyer » dans **tous les libellés visibles par le
   parent**. Les URLs (`/foyers/:id/...`), le code, l'API, les événements et la doc technique
   gardent `foyer` (renommage purement lexical côté UI).
4. Migrations cassantes autorisées si justifiées ; nouvelles dépendances autorisées si gain net
   (aucune n'est nécessaire dans ce plan — n'en ajouter aucune).

## 3. Hypothèses assumées (défauts pris — à corriger avant lancement si désaccord)

- **`nbEnfantsACharge` reste déclaratif** (notion fiscale : enfants à charge ≠ enfants gardés en
  crèche). Aucun invariant ne le lie aux lignes `enfant`. On ne « corrige » pas cette divergence.
- **`foyer.FoyerMisAJour.v2`** (défini, consommé par svc-tarification, jamais émis) : hors
  périmètre, dette assumée. Ne pas y toucher.
- **Outbox sans dead-letter** : hors périmètre (volumes minuscules, `logger.warn` existant suffit).
- **Multi-foyers par e-mail** : autorisé en base (lot 5), mais `/moi/profil` continue de résoudre
  la **première** ligne parent trouvée (limitation documentée, pas de sélecteur de profil).
- **Pas de stepper/assistant d'onboarding dédié** : guidage léger (états vides orientés action,
  explications contextuelles). Un wizard serait de la sur-ingénierie pour 4 écrans.
- **La suppression d'un enfant ayant des contrats reste autorisée** (avertie via modale, pas
  bloquée) : les contrats restent la propriété du parent, leur suppression est un geste explicite.
- « Tranche de revenus » (ContratsPage) est conservé tel quel.
- Le libellé « Parent principal (destinataire « À » par défaut) » devient
  **« Contact principal (reçoit les e-mails de la crèche en premier) »** (lot 4).

## 4. Conventions et commandes (valables pour tous les lots)

- **Package manager** : toujours `corepack pnpm@10.34.2 ...` (jamais le pnpm global 8.x).
- **Environnement de travail** : `pnpm preflight` en début de session — cf.
  [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique sur la boucle de dev.
- **Tâches via nx** : `corepack pnpm@10.34.2 nx run-many -t lint test -p <projets>` (le
  type-check est une arête de la cible `test`).
- **ESLint 9 flat config type-aware** (ratchet warn→error) : `prefer-const`,
  `noUncheckedIndexedAccess`, `ReadonlyArray<T>` interdit → `readonly T[]`, `z.uuid()` (pas
  `z.string().uuid()` déprécié), `z.array(...).readonly()` pour les tableaux readonly.
- **verbatimModuleSyntax (web uniquement)** : `import type { ... }` pour les types.
- **commitlint** : sujet ≤ 100 caractères.
- **Design** : réutiliser les tokens `--esp-1..6`, `--bleu/--vert/--rouge/--gris/--ambre` et les
  composants `ui/` existants (`ModaleConfirmation`, `StatutSauvegarde`, `EtatVide`, `Modale`,
  `Abbr`, `Badge`). Ne rien réinventer.
- **Pact** : `/pacts` est dans `.prettierignore` (ne pas le retirer, sinon lint-staged casse
  pact-drift). En cas de modification d'interactions : **régénérer les fichiers pact à blanc**
  (supprimer le JSON puis relancer le test consumer) — le mode merge produit des doublons.
- **e2e stack** : `*.stack.e2e.spec.ts` tournent contre la pile Docker ; l'orchestrateur e2e-stack
  est **destructif** (`down -v`). L'identité s'injecte via `x-dev-user-email` (dev uniquement).
  `getByDisplayValue` n'existe pas en Playwright.
- **Vérification UI locale** : stack Docker + seed, puis stopper le conteneur web et lancer Vite
  dev sur :4200. Vérifier en ~375 px de large (mobile-first).
- **Migrations svc-foyer** : SQL dans `apps/svc-foyer/src/database/migrations/`, embarquées par
  webpack dans `dist/database/migrations` et appliquées **au boot** (`MigrationService`). Nommer
  `000N_<slug>.sql` en suivant la numérotation existante (dernière : `0002_unique_naoko.sql`).

**Fichiers pivots** (mêmes chemins dans tous les lots) :

- Front : `apps/web/src/foyer/{FoyerFormPage,FoyerModifierPage,EnfantsSection,ParentsSection,FoyerScalairesForm,ContratsPage}.tsx`,
  `apps/web/src/foyer/parentErreurs.ts`, `apps/web/src/session/MoiContext.tsx`,
  `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/utils/erreurs.ts`,
  `apps/web/src/ui/EtatVide.tsx`, `apps/web/src/dashboard/DashboardJourPage.tsx`,
  `apps/web/src/styles.css`, `apps/web/src/foyer/useContrats.ts`.
- Gateway : `apps/api-gateway/src/bff/{foyers.controller,moi.controller,bff.dto}.ts`,
  `apps/api-gateway/src/bff/relais.ts`, `apps/api-gateway/src/clients/foyer.client.ts`,
  `apps/api-gateway/src/security/{creation-foyer-unique.guard,appartenance.guard,admin}.ts`.
- svc-foyer : `apps/svc-foyer/src/foyer/{foyer.controller,foyer.service,foyer.dto}.ts`,
  `apps/svc-foyer/src/database/schema.ts`, `apps/svc-foyer/src/database/migrations/`.
- Contrats : `pacts/api-gateway-svc-foyer.json`,
  `apps/api-gateway/src/contract/foyer.consumer.pact.spec.ts`,
  `apps/svc-foyer/src/contract/foyer.provider.pact.spec.ts`,
  `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` (+ types front générés
  `apps/web/src/api/openapi-types.gen.ts` / `apps/web/src/types/bff.ts`).
- e2e : `apps/web/e2e/{foyer-modifier,foyer-creation-unique,foyer-contrats,parcours,a11y}.{stack.,}e2e.spec.ts`.

---

## Lot 1 — Gestes destructifs sûrs et erreurs compréhensibles

**Modèle d'exécution : Opus 4.8.**

### Objectif

Avant : un tap sur « Supprimer » efface définitivement un enfant sans prévenir ; un parent peut se
retirer lui-même (ou changer son e-mail) et perdre l'accès à sa famille ; les 409 affichent un
message fourre-tout ; un texte à l'écran affirme l'inverse de ce que fait le système.
Après : toute action destructive passe par une confirmation qui dit la vraie conséquence ; il est
impossible de laisser une famille sans parent ; chaque erreur serveur a un message précis.

### Périmètre exact

- `apps/svc-foyer/src/foyer/foyer.service.ts` (garde dernier parent, codes d'erreur),
  `foyer.service.spec.ts`.
- `apps/api-gateway/src/bff/relais.ts`, `apps/api-gateway/src/clients/foyer.client.ts`
  (relais structuré des 4xx).
- `apps/web/src/foyer/{EnfantsSection,ParentsSection,FoyerModifierPage}.tsx` + leurs `.test.tsx`,
  `apps/web/src/foyer/parentErreurs.ts` (ou module frère pour le mapping des codes).
- `apps/web/e2e/foyer-modifier.stack.e2e.spec.ts` (mise à jour des scénarios de suppression).
- **Hors périmètre** : la migration d'index e-mail (lot 5), la création de foyer (lot 2), tout
  renommage « famille » (lot 4 — garder les libellés actuels « foyer » dans ce lot), les autres
  clients de la gateway (seul `FoyerClient` porte le relais structuré).

### Décisions déjà prises

**a) Codes d'erreur svc-foyer (409).** Dans `foyer.service.ts`, les `ConflictException` portent un
corps structuré `{ statusCode: 409, code, message }` avec ces codes exacts :

- `EMAIL_DEJA_UTILISE` — violation `parent_email_unique_idx` (message actuel conservé) ;
- `PARENT_PRINCIPAL_EXISTANT` — violation `parent_principal_unique_idx` ;
- `DERNIER_PARENT_ACTIF` — nouvelle garde (ci-dessous).
  `traduireUnicite` (`foyer.service.ts:607-617`) est adapté pour émettre ces corps.

**b) Garde « dernier parent actif » (svc-foyer).** Dans `retirerParent` **et** dans
`modifierParent` quand la mise à jour passe `actif: false` : à l'intérieur de la transaction,
verrouiller les lignes parents actives du foyer (`SELECT ... FOR UPDATE`), et si le parent visé
est le **dernier actif**, lever `ConflictException({ statusCode: 409, code: 'DERNIER_PARENT_ACTIF',
message: 'impossible de retirer le dernier parent actif du foyer' })`. Aucun événement émis dans ce
cas. La garde ne s'applique qu'à la transition 1→0 (un foyer créé sans parent par un admin reste
possible).

**c) Relais structuré des 4xx (gateway).** Nouveau type d'erreur (ex. `ErreurAmont`) portant
`status` + `corps` (JSON parsé de la réponse amont). `FoyerClient` le lève pour toute réponse
non-2xx **dont le corps est du JSON parseable** (sinon comportement actuel `Error('HTTP <code>')`).
`relayer` (`relais.ts`) : si `ErreurAmont` et `status < 500` → `throw new HttpException(corps,
status)` (le corps amont est relayé tel quel) ; sinon comportement actuel. **Ne pas toucher** aux
sémantiques 5xx / circuit-breaker / retry. Vérifier où vit l'enveloppe HTTP commune
(`appelResilient` dans les libs partagées, cf. lot 2b de l'audit 2026-07) : si le fetch est
centralisé, brancher la capture du corps au niveau de `FoyerClient` uniquement, sans modifier le
comportement des autres clients.

**d) Mapping front des codes.** Étendre `messageErreurParent` (dans `ParentsSection.tsx`, à
extraire vers `parentErreurs.ts` pour test) : lire `err.corps.code` (l'`ApiError` du client web
porte déjà le corps) :

- `EMAIL_DEJA_UTILISE` → « Cette adresse e-mail est déjà utilisée par un autre parent. »
- `PARENT_PRINCIPAL_EXISTANT` → « Un contact principal existe déjà. Décochez-le d'abord sur l'autre parent. »
- `DERNIER_PARENT_ACTIF` → « Impossible de retirer le dernier parent : la famille doit garder au moins un parent pour y accéder. »
- 409 sans code (fallback) : message fusionné actuel.

**e) Confirmations front (réutiliser `ui/ModaleConfirmation`, `destructif`).**

- **Supprimer un enfant** (`EnfantsSection`) : `FoyerModifierPage` charge les contrats via
  `useContrats(foyerId)` (`apps/web/src/foyer/useContrats.ts`, caché par clé — coût quasi nul) et
  les passe à `EnfantsSection`. Modale : titre `Supprimer {prénom}`, libellé de confirmation
  `Supprimer`, message :
  - si l'enfant a ≥ 1 contrat (`contrat.enfantId === enfant.id`) : « {prénom} a {n} contrat(s) de
    garde. Ils ne seront pas supprimés et resteront affichés avec son prénom. Supprimez-les
    d'abord depuis la page Contrats si nécessaire. Cette suppression est définitive. »
  - sinon : « {prénom} sera définitivement retiré(e). Cette action est irréversible. »
    Si les contrats n'ont pas pu être chargés (erreur), afficher la variante générique (ne pas
    bloquer la suppression sur une panne de lecture).
- **Retirer un parent** (`ParentsSection`) : modale ; si `parent.email` = `moi.email` (comparaison
  insensible à la casse, via `useMoi()`) : « C'est votre propre accès : après ce retrait, vous ne
  pourrez plus consulter ni modifier cette famille. » ; sinon : « {désignation} ne recevra plus
  les récapitulatifs et n'aura plus accès. »
- **Modifier son propre e-mail** (`ParentsSection`, ligne existante) : si l'e-mail édité change
  ET que l'e-mail d'origine = `moi.email` → modale de confirmation avant le PUT : titre
  « Modifier votre adresse e-mail », message « Votre accès est lié à l'adresse {ancienne}. Si vous
  la remplacez, vous perdrez l'accès avec votre connexion actuelle. », confirmation « Modifier
  quand même » (`destructif`).

**f) Correction du texte périmé** (`EnfantsSection.tsx:35-38`) — remplacer par :
« Renommer un enfant met aussi à jour ses contrats de garde. Supprimer un enfant ne supprime pas
ses contrats. »

### Critères d'acceptation

- Parent : aucune suppression (enfant, parent) ne part sans modale de confirmation ; le focus
  initial est sur « Annuler » (comportement `ModaleConfirmation` existant).
- Parent : retirer le dernier parent affiche « Impossible de retirer le dernier parent… » (409
  traduit), la ligne reste affichée.
- Parent : retirer sa propre ligne ou changer son propre e-mail affiche l'avertissement d'accès.
- Technique : `retirerParent`/`modifierParent(actif:false)` sur le dernier parent actif → 409
  `DERNIER_PARENT_ACTIF` **au niveau svc-foyer** (test unitaire, y compris sous concurrence
  simulée : la garde est dans la transaction, pas en pré-lecture hors transaction).
- Technique : un 409 amont arrive au front avec son `code` (test gateway sur `relayer` +
  `FoyerClient`, test front sur le mapping).
- Le texte de `EnfantsSection` reflète la réalité (renommage propagé, contrats conservés).

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web api-gateway svc-foyer
```

- UI réelle (stack + Vite :4200, viewport 375 px) : supprimer un enfant avec et sans contrat
  (messages différents), tenter de retirer l'unique parent (message dernier-parent), éditer son
  propre e-mail (avertissement).
- e2e : adapter `foyer-modifier.stack.e2e.spec.ts` (les suppressions passent désormais par la
  modale — cliquer le bouton de confirmation dans le dialog) et ajouter le scénario « retirer le
  dernier parent → message d'erreur explicite ».

### Pièges connus

- Les tests unitaires de `foyer.service.spec.ts` mockent Drizzle : suivre le pattern existant
  (transactions mockées, cf. tests outbox l.128-176).
- `ParentsSection` compare à `moi.email` : `useMoi()` retombe sur `email: null` en mode hérité —
  dans ce cas, pas d'avertissement « propre accès » (comportement assumé).
- Ne pas casser le contrat Pact existant : les nouveaux corps 409 ne sont **pas** encore
  contractualisés (ça vient au lot 5) ; les interactions nominales existantes ne changent pas.
- e2e stack : l'e-mail injecté est `x-dev-user-email` ; c'est lui qui doit matcher la ligne parent
  pour tester l'avertissement « propre accès ».

---

## Lot 2 — Création de foyer atomique (la commande au bon endroit)

**Modèle d'exécution : Opus 4.8.** Dépendance : aucune (indépendant du lot 1 ; si le lot 1 est
mergé d'abord, reprendre ses codes d'erreur tels quels).

### Objectif

Avant : « Créer le foyer » déclenche jusqu'à 1 + N + M appels HTTP en chaîne depuis la gateway ;
une coupure 4G au milieu laisse un foyer à moitié créé (sans enfants, sans le parent créateur →
inaccessible en mode enforce). Après : **une seule commande, une seule transaction** dans
svc-foyer ; la création réussit entièrement ou échoue entièrement, et la règle « le créateur
devient parent » vit dans le service métier.

### Périmètre exact

- `apps/svc-foyer/src/foyer/{foyer.dto,foyer.service,foyer.controller}.ts` + specs.
- `apps/api-gateway/src/bff/foyers.controller.ts` (méthode `creer`, suppression de
  `parentsAvecCreateur`), `apps/api-gateway/src/clients/foyer.client.ts` (payload/réponse),
  `apps/api-gateway/src/bff/bff.dto.ts` si nécessaire (le schéma d'entrée BFF ne change pas).
- Pact : `apps/api-gateway/src/contract/foyer.consumer.pact.spec.ts`,
  `apps/svc-foyer/src/contract/foyer.provider.pact.spec.ts`, `pacts/api-gateway-svc-foyer.json`
  (régénéré à blanc).
- **Hors périmètre** : le front (`api.creerFoyer` et le contrat BFF `/api/v1/foyers` ne changent
  pas — même requête, même réponse dossier), l'OpenAPI gateway, les événements NATS (types
  inchangés), le PUT foyer.

### Décisions déjà prises

**a) Contrat svc-foyer.** `POST /api/foyers` accepte désormais un corps étendu (tous les nouveaux
champs **optionnels** — rétrocompatible) :

```
{ ...scalaires actuels,
  enfants?: AjouterEnfantDto[],      // max 20
  parents?: AjouterParentDto[],      // max 10
  createurEmail?: string             // e-mail vérifié du créateur non-admin
}
```

Réponse : le **dossier complet** `{ foyer: FoyerVue, enfants: EnfantVue[], parents: ParentVue[] }`
(statut 201). Zod : réutiliser `ajouterEnfantSchema`/`ajouterParentSchema` existants dans
`foyer.dto.ts` ; `createurEmail: z.email().optional()`.

**b) Service.** `FoyerService.creer` fait **une seule `db.transaction`** :

1. validation domaine (`Foyer.creer`, `Enfant.creer` pour chaque enfant) **avant** toute écriture ;
2. insert `foyer` + outbox `FoyerMisAJour` ;
3. insert chaque `enfant` + outbox `EnfantAjoute` ;
4. calcul de la liste finale des parents : **porter la logique `parentsAvecCreateur` depuis
   `apps/api-gateway/src/bff/foyers.controller.ts:236-253` à l'identique** (dédoublonnage e-mail
   insensible à la casse ; si `createurEmail` est fourni et absent de la liste, l'ajouter en fin
   avec `ordre` suivant) — puis la **supprimer de la gateway** ;
5. insert chaque `parent` + outbox `ParentAjoute` (via `evenementParentEtat` existant) ;
6. `traduireUnicite` englobe la transaction : un e-mail dupliqué → 409 et **tout est annulé**
   (foyer compris).

**c) Gateway.** `foyers.controller.creer` : valide le corps BFF (schéma existant inchangé),
détermine `createurEmail` avec la **même condition qu'aujourd'hui** (identité présente ET
non-admin — reprendre le prédicat actuel autour de `parentsAvecCreateur`), fait **un seul appel**
`FoyerClient.creerFoyer(...)`, renvoie le dossier. Supprimer les boucles `ajouterEnfant`/
`ajouterParent`.

**d) Pact.** Mettre à jour l'interaction `POST /api/foyers` : requête avec `enfants`, `parents`,
`createurEmail` ; réponse dossier complet. Ajouter/adapter le provider state correspondant.
Régénérer `pacts/api-gateway-svc-foyer.json` **à blanc**. Gateway et svc-foyer vivent dans le même
repo et se déploient ensemble par release train : pas de fenêtre d'incompatibilité.

### Critères d'acceptation

- Parent : une création interrompue (panne svc-foyer simulée au milieu — désormais impossible par
  construction) ne peut plus produire de dossier partiel : soit le dossier complet existe, soit
  rien.
- Technique : test unitaire svc-foyer « échec d'insertion du 2ᵉ parent (e-mail dupliqué) →
  rollback complet, aucune ligne `foyer`/`enfant`/`outbox` » (suivre le pattern rollback existant
  l.166 de `foyer.service.spec.ts`).
- Technique : le créateur non-admin est rattaché parent par **svc-foyer** (test unitaire :
  `createurEmail` absent de `parents` → ligne ajoutée ; présent → pas de doublon). L'admin
  (`createurEmail` non fourni) n'est pas rattaché.
- Technique : les événements `FoyerMisAJour` + N×`EnfantAjoute` + M×`ParentAjoute` sont tous dans
  l'outbox de la même transaction.
- `parentsAvecCreateur` n'existe plus dans la gateway ; e2e
  `foyer-creation-unique.stack.e2e.spec.ts` passe inchangé (créateur toujours rattaché, `/moi` le
  voit propriétaire).
- Pact : consumer + provider verts, `can-i-deploy` inchangé/vert.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p svc-foyer api-gateway
corepack pnpm@10.34.2 nx run api-gateway:test --testPathPattern=pact   # consumer
# provider pact : tourne en CI contre Postgres (bloquant CI, ignoré local sans base)
```

- Bout-en-bout (stack Docker) : créer un foyer avec 2 enfants + 1 parent via l'UI → vérifier en
  base svc-foyer (foyer + 2 enfants + 2 parents dont créateur), puis que les projections suivent
  (read model `enfant` dans svc-tarification, `foyer_parent` dans svc-notifications).
- e2e : `foyer-creation-unique.stack.e2e.spec.ts` et `parcours.e2e.spec.ts` verts sans
  modification de leurs assertions métier.

### Pièges connus

- Le provider pact seede via `stateHandlers` : ajouter l'état pour la nouvelle interaction, sinon
  échec CI silencieusement ignoré en local (le spec s'ignore sans Postgres).
- Pact merge → doublons : **supprimer le JSON et régénérer**, ne pas laisser l'ancien contenu.
- Les événements outbox portent `traceIdCourant()` : conserver ce champ dans les nouvelles
  insertions (pattern existant `foyer.service.ts:217`).
- `max(20)` enfants / `max(10)` parents : bornes défensives, à refléter dans le schéma Zod (pas de
  validation côté BFF supplémentaire — il borne déjà à sa façon ; ne pas dupliquer davantage).
- Ne pas toucher au comportement `@CreationFoyerUnique` (fail-open) dans ce lot — il est traité au
  lot 5.

---

## Lot 3 — Onboarding guidé et session fraîche

**Modèle d'exécution : Opus 4.8.** Dépendance : aucune. (Peut se faire en parallèle des lots 1-2 ;
en cas de conflit sur `FoyerFormPage`, rebaser sur le lot mergé.)

### Objectif

Avant : le nouveau parent tombe sur un formulaire fiscal inexpliqué ; après création, revenir à
l'accueil lui affirme qu'il n'a pas de foyer ; son dashboard neuf ne lui dit pas quoi faire.
Après : le formulaire raconte ce qu'on construit (enfants → parents → ressources, avec le
pourquoi) ; la session sait immédiatement qu'il a une famille ; le dashboard vide pointe vers le
premier geste utile (créer un contrat).

### Périmètre exact

- `apps/web/src/session/MoiContext.tsx` (+ test), `apps/web/src/foyer/FoyerFormPage.tsx`
  (+ test), `apps/web/src/foyer/FoyerScalairesForm.tsx`,
  `apps/web/src/dashboard/DashboardJourPage.tsx` (+ test), `apps/web/src/ui/EtatVide.tsx`
  (+ usages), `apps/web/src/App.tsx` (docstring `MesFoyersPage` uniquement).
- `apps/web/e2e/foyer-creation-unique.stack.e2e.spec.ts` (scénario fraîcheur ajouté).
- **Hors périmètre** : tout renommage « famille » (lot 4), l'écran d'édition (lot 4), le backend.

### Décisions déjà prises

**a) Fraîcheur de session.** `MoiContext` expose `recharger: () => void` (c'est le `reload` déjà
renvoyé par `useAsync` — `apps/web/src/hooks/useAsync.ts:66-74`). L'ajouter au type `EtatMoi` et
au `DEFAUT` (no-op). `FoyerFormPage.soumettre` : après `api.creerFoyer` réussi →
`setFoyerId(...)`, `moi.recharger()`, puis `void navigate(...)` (ordre exact ; `recharger` est
synchrone, il invalide et relance — pas d'`await`).

**b) Réordonnancement du formulaire de création** (`FoyerFormPage`) — nouvel ordre et textes
exacts :

1. Intro sous le `h1` : « Votre famille regroupe vos enfants, les parents qui suivent leur garde,
   et vos ressources pour estimer les tarifs. »
2. **Enfants** (fieldset existant, inchangé).
3. **Parents** — remplacer le texte d'aide par : « Chaque parent recevra les récapitulatifs
   hebdomadaires et pourra accéder à l'application avec son adresse e-mail. »
4. **Ressources** (`FoyerScalairesForm`) — ajouter dans le composant partagé, sous la légende, le
   paragraphe (`className="muted"`) : « Ces informations servent uniquement à estimer le coût de
   la garde (barème CAF). Vous pourrez les modifier à tout moment. » (Partagé : l'édition en
   bénéficie aussi.)
   Le bouton de soumission et la logique ne changent pas.

**c) Dashboard d'un foyer sans contrat.** Dans `DashboardJourPage`, branche
`data && lignes.length === 0` (carte « Aucune garde prévue aujourd'hui », l.457-466) : extraire un
sous-composant qui appelle `useContrats(id)` (cache par foyer — pas de coût récurrent) :

- si `!chargement && contrats.length === 0` : remplacer `ProchaineGarde` + « Voir le planning »
  par le texte « Pour démarrer, créez le contrat de garde de votre enfant : c'est lui qui
  alimente le planning et les coûts. » + `Link` classe `btn` (primaire) « Créer un contrat » vers
  `/foyers/{id}/contrats` ;
- sinon (contrats existants, ou lecture en cours/échouée) : contenu actuel inchangé.

**d) `EtatVide` en navigation SPA.** Les actions `href` commençant par `/` sont rendues avec
`<Link to>` (react-router) ; les autres restent `<a href>`. Ajouter un champ optionnel
`rechargement?: boolean` sur `ActionEtatVide` qui force `<a href>` — et le poser sur les actions
des écrans de récupération de `GardeFoyer` qui **nécessitent** un rechargement complet
(`SessionExpiree` notamment : la reconnexion Cloudflare Access exige un aller-retour complet ;
vérifier chaque usage dans `App.tsx:341-388` et ne forcer `rechargement` que là où c'est
justifié). La fraîcheur de `/moi` ne repose plus sur ce rechargement (corrigée en a).

**e) Docstring `MesFoyersPage`** (`App.tsx:67-70`) : remplacer la mention périmée « contactez
l'administrateur » par la réalité self-service (« 0 foyer → EtatVide "Créer mon foyer" »).

### Critères d'acceptation

- Parent : créer sa famille puis naviguer vers `/` (navigation SPA, sans reload) → il est routé
  vers son dashboard, plus jamais vers « Vous n'avez pas encore de foyer ».
- Parent : le lien « Nouveau foyer » du panneau « Plus » disparaît après la création (dérivé de
  `moi.foyers`, désormais frais).
- Parent : sur un foyer sans contrat, le dashboard propose « Créer un contrat » en un tap.
- Parent : le formulaire de création commence par les enfants et explique à quoi servent les
  ressources.
- Technique : test unitaire `MoiContext`/`FoyerFormPage` couvrant le `recharger()` après création ;
  test `DashboardJourPage` pour les deux branches (0 contrat / ≥1 contrat) ;
  `EtatVide` testé pour `Link` vs `<a>` (interne/externe/`rechargement`).
- e2e stack : scénario ajouté dans `foyer-creation-unique.stack.e2e.spec.ts` — après création via
  l'UI, cliquer le logo/lien d'accueil (navigation SPA) et vérifier l'arrivée sur le dashboard.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web
```

- UI réelle (stack + Vite :4200, 375 px) : dérouler le parcours complet nouveau parent
  (`x-dev-user-email` inédit) : accueil → « Créer mon foyer » → formulaire réordonné → création →
  contrats → retour accueil (SPA) → dashboard → carte « Créer un contrat ».
- e2e stack (destructif, `down -v`) : suites foyer vertes.

### Pièges connus

- `useAsync` avec `cle` : `moi` est appelé **sans** clé de cache (deps `[]`) — `reload` suffit, ne
  pas introduire de clé (le cache module-level survivrait aux tests ; `viderCacheAsync` existe
  pour les tests qui en ont besoin).
- `EtatVide` est utilisé par les écrans de récupération : casser le rechargement complet de
  `SessionExpiree` = parent bloqué dans une session morte. Tester ce cas à la main (couper le
  cookie/simuler 302 Access est difficile — a minima vérifier que l'action garde `<a href>`).
- Les tests `App.test.tsx` existants peuvent asserter les `<a>` d'`EtatVide` : les adapter.
- Ne pas renommer les libellés « foyer » ici (évite les conflits avec le lot 4 et garde les specs
  e2e stables dans ce lot).

---

## Lot 4 — Écran d'édition cohérent + langage « ma famille »

**Modèle d'exécution : Opus 4.8 pour les sous-parties a/b (comportement) ; les sous-parties c/d
(renommage + classes CSS) sont intégralement décidées ci-dessous et _délégables à Sonnet 5_.**
Dépendance : lots 1 et 3 mergés (mêmes fichiers ; le renommage doit englober leurs nouveaux
libellés).

### Objectif

Avant : « Enregistrer les modifications » éjecte vers le planning (même « Annuler ») ; les lignes
parents/enfants s'enregistrent sans aucun signe visible ; l'écran mélange styles inline et
jargon (« foyer », « destinataire À »). Après : on reste sur la page, chaque enregistrement
affiche « Enregistré à HH:MM », l'écran s'appelle « Ma famille » et parle le langage d'un parent.

### Périmètre exact

- Comportement : `apps/web/src/foyer/{FoyerModifierPage,ParentsSection,EnfantsSection}.tsx`
  (+ tests).
- Renommage + CSS : tous les libellés **visibles** contenant « foyer » sous `apps/web/src/**` et
  `apps/web/e2e/**` ; `apps/web/src/styles.css` (nouvelles classes).
- **Hors périmètre** : URLs/routes (`/foyers/...` inchangées), noms de code (composants, types,
  API, événements, tables), documentation technique, `docs/**`, commentaires de code (on peut les
  laisser dire « foyer »).

### Décisions déjà prises

**a) `FoyerModifierPage` — rester sur place.**

- Supprimer les deux `navigate('/foyers/${id}/planning')` (submit et Annuler).
- Après un PUT réussi : rester sur la page, afficher `StatutSauvegarde` (composant existant
  `apps/web/src/ui/StatutSauvegarde.tsx`) à côté du bouton : `en-cours` pendant l'écriture,
  `enregistre` avec l'heure locale (`new Date().toLocaleTimeString('fr-FR', { hour: '2-digit',
minute: '2-digit' })`), `erreur` sinon (en plus du message d'erreur existant).
- « Annuler » devient « Rétablir » : restaure `valeursDepuisFoyer(foyer)` **avec les dernières
  valeurs enregistrées** (conserver en état la dernière réponse du PUT — le PUT renvoie la vue à
  jour ; sinon les valeurs chargées au montage), efface les erreurs, reste sur la page.
- Réordonner les sections comme la création : **Enfants, Parents, Ressources** (le formulaire de
  scalaires descend en bas, son submit ne bouge pas de son bloc).
- Titre de page et `h1` : « Ma famille » (`useTitrePage('Ma famille')`).

**b) Lignes parents/enfants — feedback.** Chaque ligne (`LigneParentExistant`,
`LigneEnfantExistant`, et les deux formulaires d'ajout) affiche son propre `StatutSauvegarde`
(état local par ligne) à côté des boutons : `en-cours` pendant `occupe`, `enregistre` + heure au
succès, `erreur` à l'échec. L'état `enregistre` persiste (comportement du composant).

**c) Renommage « famille » (délégable à Sonnet 5).** Remplacements exacts, partout où le texte est
**visible par le parent** (JSX text, `aria-label`, `useTitrePage`, props d'`EtatVide`, messages
d'erreur/succès, placeholders) — greper `foyer` (insensible à la casse) sous `apps/web/src` et
`apps/web/e2e` et appliquer :

| Avant (existant)                                            | Après                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Nouveau foyer (titre + h1 `FoyerFormPage`)                  | Créer ma famille                                                                                 |
| Créer le foyer (bouton submit)                              | Créer ma famille                                                                                 |
| Création en cours…                                          | (inchangé)                                                                                       |
| Vous avez déjà un foyer (×2, EtatVide + erreur 409)         | Vous avez déjà une famille                                                                       |
| Vous ne pouvez créer qu'un seul foyer. Modifiez le vôtre…   | Vous ne pouvez créer qu'une seule famille. Modifiez la vôtre plutôt que d'en créer une nouvelle. |
| Modifier mon foyer (action EtatVide)                        | Voir ma famille                                                                                  |
| Modifier le foyer (titre + h1 + lien Entete/panneau Plus)   | Ma famille                                                                                       |
| Chargement du foyer…                                        | Chargement de votre famille…                                                                     |
| Foyer indisponible.                                         | Famille indisponible.                                                                            |
| Mes foyers (titre, lien)                                    | Mes familles                                                                                     |
| Vous n'avez pas encore de foyer                             | Vous n'avez pas encore créé votre famille                                                        |
| Créez votre foyer pour commencer…                           | Créez votre famille pour commencer à planifier la garde de vos enfants.                          |
| Créer mon foyer                                             | Créer ma famille                                                                                 |
| Ouvrir le foyer {n} (aria-label MesFoyersPage)              | Ouvrir la famille {n}                                                                            |
| Nouveau foyer (lien panneau Plus)                           | Nouvelle famille                                                                                 |
| Ressources du foyer (légende `FoyerScalairesForm`)          | Ressources de la famille                                                                         |
| **Foyer** (carte ContratsPage l.174)                        | Famille                                                                                          |
| Impossible de charger les données du foyer :                | Impossible de charger les données de la famille :                                                |
| Parent principal (destinataire « À » par défaut)            | Contact principal (reçoit les e-mails de la crèche en premier)                                   |
| …de la famille dans les libellés introduits aux lots 1 et 3 | garder « famille » (déjà rédigés ainsi)                                                          |

Toute autre occurrence visible découverte au grep : appliquer la même logique (foyer→famille,
accords ajustés). **Ne pas toucher** : identifiants de code, routes, `data-*`, clés API, tests
d'API (corps JSON), commentaires. Mettre à jour les **assertions e2e et tests unitaires** qui
ciblent ces textes (`getByRole('link', { name: 'Modifier le foyer' })`, etc. — fichiers listés
en §4 ; le lien testé dans `foyer-modifier.stack.e2e.spec.ts` devient « Ma famille »).

**d) Classes CSS (délégable à Sonnet 5).** Dans `styles.css`, créer et utiliser à la place des
styles inline des pages foyer :

- `.page-etroite { max-width: 600px; }` (remplace `style={{ maxWidth: 600 }}`) ;
- `.champs-duo { display: flex; flex-direction: column; gap: var(--esp-2); }` +
  `@media (min-width: 480px) { .champs-duo { flex-direction: row; } .champs-duo > * { flex: 1; } }`
  (remplace les rangées inline `display:flex; gap:0.5rem` de prénom/nom et prénom/date) ;
- `.case-cochable { display: flex; align-items: center; gap: var(--esp-2); min-height: 2.75rem; }`
  et `.case-cochable input[type="checkbox"] { width: 1.25rem; height: 1.25rem; }` (case
  « Contact principal » — cible tactile ≥ 44 px) ;
- `.actions-ligne { display: flex; gap: var(--esp-2); margin-top: var(--esp-2); }` (boutons des
  lignes) ; sous 480 px, empiler : `@media (max-width: 479px) { .actions-ligne { flex-wrap: wrap; } }`.
  Remplacer les `style={{...}}` correspondants dans `FoyerFormPage`, `FoyerModifierPage`,
  `ParentsSection`, `EnfantsSection`, `FoyerScalairesForm` (marges ponctuelles restantes : utiliser
  les tokens `--esp-*` si une classe existante ne couvre pas). Ne pas retoucher les autres pages.

### Critères d'acceptation

- Parent : après « Enregistrer », il voit « Enregistré à HH:MM » et **reste sur la page** ; chaque
  ligne parent/enfant a son propre statut.
- Parent : plus aucun « foyer » visible à l'écran (parcourir création, édition, mes familles,
  contrats, entête/panneau Plus) ; la case « Contact principal » se coche confortablement au pouce.
- Technique : `grep -ri "foyer" apps/web/src --include="*.tsx"` ne matche plus aucun **littéral de
  texte visible** (identifiants/commentaires OK) ; zéro style inline de layout dans les 5 fichiers
  foyer (hors cas ponctuels justifiés) ; tests et e2e adaptés verts.
- Aucun scroll horizontal à 375 px et 320 px sur création/édition.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web
```

- UI réelle 375 px et 320 px : création + édition (statuts d'enregistrement, casse « Contact
  principal », empilement des boutons).
- e2e stack : `foyer-modifier`, `foyer-creation-unique`, `parcours`, `a11y` verts après mise à
  jour des libellés.

### Pièges connus

- **Tout libellé visible modifié doit être répercuté dans les specs e2e** (`*.stack.e2e.spec.ts`
  et `parcours.e2e.spec.ts`) — c'est le piège n°1 du repo sur les renommages.
- `StatutSauvegarde` : une seule région `role="status"` par instance — ne pas monter/démonter le
  composant entre états (passer par `etat`), sinon les lecteurs d'écran perdent l'annonce.
- Le test a11y (`a11y.e2e.spec.ts`) peut cibler des noms accessibles renommés.
- « Rétablir » restaure les **dernières valeurs enregistrées**, pas les valeurs du montage si un
  PUT a réussi entre-temps (sinon on « annule » silencieusement un enregistrement réussi).

---

## Lot 5 — Intégrité du modèle parent et contrats d'erreur

**Modèle d'exécution : Opus 4.8.** Dépendance : **lot 1 mergé** (codes d'erreur + garde dernier
parent contractualisés ici).

### Objectif

Avant : l'index e-mail global contredit le modèle multi-foyers et condamne l'e-mail d'un parent
retiré ; la liste des foyers est visible de tous ; la garde anti-doublon s'ouvre en cas de panne ;
Pact ne couvre que les chemins heureux. Après : le modèle en base dit la même chose que le modèle
d'autorisation ; retirer un parent est réversible ; les erreurs clés sont contractualisées.

### Périmètre exact

- `apps/svc-foyer/src/database/schema.ts` + nouvelle migration
  `apps/svc-foyer/src/database/migrations/0003_parent_email_par_foyer.sql`.
- `apps/svc-foyer/src/foyer/foyer.service.ts` (réactivation, `traduireUnicite`, commentaires) +
  specs.
- `apps/api-gateway/src/bff/foyers.controller.ts` (`lister` scopé),
  `apps/api-gateway/src/bff/moi.controller.ts` (docstring `resoudreParentCourant`),
  `apps/api-gateway/src/security/creation-foyer-unique.guard.ts` (+ specs).
- Pact : consumer + provider + `pacts/api-gateway-svc-foyer.json` (régénéré à blanc).
- **Hors périmètre** : `FoyerMisAJour.v2`, dead-letter outbox, l'UI (aucun changement front requis
  — les messages du lot 1 restent valables).

### Décisions déjà prises

**a) Migration `0003_parent_email_par_foyer.sql`** (appliquée au boot par `MigrationService`) :

```sql
DROP INDEX parent_email_unique_idx;
CREATE UNIQUE INDEX parent_email_par_foyer_actif_idx
  ON parent (foyer_id, lower(email)) WHERE actif;
```

Mettre à jour `schema.ts` (définition + le commentaire l.52-63 : l'e-mail n'est plus « unique à
l'échelle du système » ; un e-mail = 0..n foyers ; réactivable après retrait). Migration réversible
en théorie (recréer l'index global) mais **seulement tant qu'aucun doublon inter-foyer n'existe** —
le noter dans l'en-tête SQL. Données prod actuelles (2 parents) : aucun doublon, pose sans risque.

**b) Réactivation au ré-ajout.** `ajouterParent` : dans la transaction, si une ligne **inactive**
du même foyer porte le même `lower(email)` → **réactiver cette ligne** (update : `actif=true`,
prenom/nom/principal/ordre pris de la saisie, même `id`) au lieu d'insérer, et émettre
`ParentAjoute` (état complet — les consommateurs upsertent par `id`, la projection
`foyer_parent` repasse `actif=true`). Test unitaire dédié.

**c) `traduireUnicite`** : faire correspondre le **nouveau nom d'index**
(`parent_email_par_foyer_actif_idx`) au code `EMAIL_DEJA_UTILISE` (lot 1) ; garder
`parent_principal_unique_idx` → `PARENT_PRINCIPAL_EXISTANT`. Le message e-mail devient
« adresse e-mail déjà utilisée dans ce foyer ».

**d) `resoudreParentCourant`** (`moi.controller.ts:201-216`) : le comportement (première ligne
correspondante parmi les foyers, dans l'ordre) est **conservé** ; réécrire la docstring —
l'e-mail n'est plus globalement unique, un parent multi-foyers voit son profil/préférences/inbox
résolus sur son **premier** foyer (limitation assumée, cf. hypothèses §3).

**e) `GET /api/v1/foyers` scopé** (`foyers.controller.lister`) :

- identité présente + non-admin → ne renvoyer que les foyers de `foyersParEmail(email)` ;
- admin → liste complète (provisioning) ;
- identité absente (mode hérité sans Cloudflare) → liste complète (compatibilité, comportement
  actuel).
  Mettre à jour le commentaire « gap assumé » (l.100-104) qui devient obsolète. `MesFoyersPage`
  continue de fonctionner sans changement.

**f) `@CreationFoyerUnique` fail-closed sous enforce** : quand la résolution `foyersParEmail`
échoue, si `FOYER_AUTHZ_ENFORCE` est actif (réutiliser la même lecture d'env que
`appartenance.guard.ts`) → lever 503 (`ServiceUnavailableException`) au lieu de laisser passer ;
sans enforce, conserver le fail-open (dev/hérité). Spec unitaire pour les deux modes.

**g) Pact — nouvelles interactions** (consumer `foyer.consumer.pact.spec.ts` + provider states) :

1. `GET /api/foyers?parentEmail=...` → 200 (vérifier d'abord la forme réelle renvoyée par
   `FoyerClient.foyersParEmail` et contractualiser cette forme) ;
2. `POST /api/foyers/:id/parents` → **409** corps `{ statusCode: 409, code: 'EMAIL_DEJA_UTILISE',
message: ... }`, état « un parent actif avec cet e-mail existe déjà dans ce foyer » ;
3. `DELETE /api/foyers/:id/parents/:parentId` → **409** code `DERNIER_PARENT_ACTIF`, état « le
   foyer n'a qu'un seul parent actif » ;
4. `GET /api/foyers/:id` → **404**, état « aucun foyer avec cet id ».
   Régénérer le JSON à blanc ; ajouter les `stateHandlers` provider correspondants (seed/rollback).

### Critères d'acceptation

- Parent : retirer un parent puis ré-ajouter la même adresse fonctionne (la ligne est réactivée,
  il reçoit à nouveau les récapitulatifs — vérifier la projection `foyer_parent` repasse active).
- Parent (famille recomposée) : la même adresse peut être parent de deux familles ; `/moi` liste
  les deux ; « Mes familles » les affiche.
- Sécurité : en mode identifié non-admin, `GET /api/v1/foyers` ne renvoie que ses foyers (spec
  gateway) ; en enforce, une panne de svc-foyer pendant `POST /foyers` → 503, pas de création.
- Technique : migration 0003 appliquée au boot (démarrage stack : logs MigrationService) ;
  insertion d'un doublon actif même foyer → 409 `EMAIL_DEJA_UTILISE` ; doublon inter-foyers →
  accepté.
- Pact : 4 nouvelles interactions vertes consumer + provider ; `can-i-deploy` vert ; pact-drift
  propre.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p svc-foyer api-gateway
# stack Docker : boot svc-foyer applique 0003 (vérifier les logs), puis :
#  - ajouter/retirer/ré-ajouter un parent via l'UI (réactivation)
#  - créer un 2e foyer admin avec le même e-mail parent (multi-foyers OK)
```

- e2e stack : `foyer-modifier.stack.e2e.spec.ts` — supprimer le contournement « e-mail unique par
  run » (commentaire l.104-106) et tester le ré-ajout du même e-mail.

### Pièges connus

- **Ordre de déploiement** : la migration est additive/substitutive et rétrocompatible avec le
  code du lot 1 (les codes d'erreur ne dépendent pas du nom d'index côté front). Déployer via le
  release train standard.
- Drizzle `uniqueIndex(...).where(...)` : suivre la syntaxe du `parent_principal_unique_idx`
  existant (`schema.ts:87-89`).
- La réactivation doit rester dans la **même transaction** que l'outbox `ParentAjoute` (pattern
  existant).
- Le spec provider pact seede par `stateHandlers` : l'état « un seul parent actif » doit créer
  foyer + parent en base réelle.
- `estGatingAdminActif` : `admin` est permissif tant que `ADMIN_EMAILS` est vide — les specs du
  scoping `lister` doivent poser `ADMIN_EMAILS` pour tester le chemin non-admin.
- Ne pas oublier `foyer-events.ts:99-107` et les commentaires de `foyersParEmail`
  (`foyer.service.ts:411-414`) : les mettre en cohérence avec le nouveau modèle.

---

## Ordre d'exécution et dépendances

```
Lot 1 (gestes destructifs + codes erreurs)  ──┐
Lot 2 (création atomique)                     ├─ indépendants entre eux
Lot 3 (onboarding + fraîcheur)              ──┘
Lot 4 (édition + « ma famille »)  — suppose lots 1 et 3 mergés
Lot 5 (intégrité + Pact)          — suppose lot 1 mergé
```

Après merge des 5 lots : déploiement via le release train habituel (`deploy.mjs`, poller auto).
Une seule migration (svc-foyer `0003`, lot 5), aucun nouveau secret ni variable d'environnement.
Reste humain post-deploy : smoke live par un parent CF (création famille test par l'admin,
ré-ajout d'un parent retiré).
