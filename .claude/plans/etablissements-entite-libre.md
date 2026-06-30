# Établissements en entité libre (configurables, par foyer, liés aux contrats)

> **Statut** : ✅ **LIVRÉE EN PRODUCTION le 2026-06-30** (6 phases / 6). Ce document est conservé comme **record de conception**.
> **Déclencheur** : en prod, l'onglet « Établissements » affichait des noms de test (« Crèche Les Hirondelles », « École ABCM ») **codés en dur** dans un seed. Le modèle ne connaissait que **2 établissements figés** déduits du `mode` de garde, non configurables, sans lien explicite avec les contrats.
>
> **Résultat livré** (PR mergées) : P1 #87 `b4c297f` (modèle), P2 #99 `26d0692` (lien contrat), P3 #100 `a148c15` (projection notif), P4 #101 `2ce17ce` (dette envoi/scheduler) + #102 `716ea64` (web), P5 #103 `8473614` (back-fill) + #104 `ff15fbc` (verrou NOT NULL), P6 #105 `88287da` (démantèlement de l'ancien modèle).
> **Déploiements prod** : release `0.5.0` (`ae3cf95`, Deployment #5244615361) = P1→P5 + back-fill exécuté (4 établissements, 8 contrats, 0 NULL) ; release `0.6.0` (`873b5ba`, Deployment #5250651442) = #104 + #105 → ancienne table `etablissement_destinataire` droppée, `contrat.etablissement_id` NOT NULL. Doc projet : doc 06 §25 / §25.3.
> **Reste hors-code** : renommage des fiches placeholder par le PO via l'écran Établissements.

---

## 1. Objectif

Transformer l'« établissement » d'une **énumération fermée de 2 valeurs** en une **vraie entité-données libre**, configurable par l'utilisateur, et lier explicitement les contrats à un établissement (avec création à la volée).

### Décisions produit (verrouillées)

| Sujet         | Décision                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nature        | Vraie entité libre : créable / éditable / supprimable, en nombre illimité                                                                                                   |
| Portée        | **Par foyer** (chaque foyer a ses propres établissements, isolés des autres)                                                                                                |
| Fiche         | Nom + e-mail de service + règle de préavis + **coordonnées/contact** + **types proposés** (multi : un même établissement peut faire crèche _et_ cantine _et_ périscolaire…) |
| Lien contrat  | Le contrat **référence explicitement** un établissement ; à la saisie : **choisir dans la liste OU créer à la volée** si absent                                             |
| Mode de garde | **Reste** le type/tarif/structure du contrat (`CRECHE_PSU` / `CANTINE` / `PERISCOLAIRE` / `ALSH`), **indépendant** de l'établissement                                       |
| Suppression   | **Bloquée** tant que des contrats y sont rattachés (l'utilisateur réaffecte/supprime d'abord)                                                                               |
| Prod          | Vrais contrats présents → **migration nécessaire** ; livraison **d'un bloc** (pas de patch intermédiaire)                                                                   |

### Décision technique (verrouillée)

**`svc-planification` devient propriétaire de l'entité établissement.** C'est le service qui possède déjà les contrats et la notion de foyer : on obtient une **vraie clé étrangère `contrat.etablissement_id` dans la même base** et une **création à la volée atomique** (contrat + nouvel établissement dans la même transaction). `svc-notifications` **reçoit** les établissements par **projection NATS** (pattern déjà en place pour les contrats et pour les parents-foyer) et **abandonne son rôle de source de vérité** (suppression du seed + de l'énumération fermée).

---

## 2. État actuel (constat)

### Où vivent les établissements aujourd'hui

- **Source de vérité** : `svc-notifications`, table `etablissement_destinataire`
  - Schéma : `apps/svc-notifications/src/database/schema.ts:115-133`
  - Migration : `apps/svc-notifications/src/database/migrations/0002_etablissement_destinataire.sql`
  - Colonnes : `id`, `cle` (UNIQUE), `libelle`, `email_service`, `preavis_regle` (jsonb), `actif`, timestamps
- **Seed en dur (2 établissements)** : `apps/svc-notifications/src/etablissement/etablissement.service.ts:46-59`
  - `CRECHE_HIRONDELLES` → « Crèche Les Hirondelles », `contact-creche@example.org`, préavis 2 jours ouvrés
  - `ABCM` → « École ABCM », `contact-abcm@example.org`, préavis jeudi 12:00
- **Énumération fermée** rebattue partout :
  - `apps/svc-notifications/src/etablissement/etablissement.dto.ts:15` (`CLES_ETABLISSEMENT`)
  - `apps/api-gateway/src/bff/bff.dto.ts:123`
  - `apps/api-gateway/src/clients/notifications.client.ts` (schémas Zod)
  - `apps/api-gateway/src/bff/semaine-besoins.ts:26` + types web générés

### Comment un contrat « choisit » son établissement aujourd'hui

- La table `contrat` (`apps/svc-planification/src/database/schema.ts:27-57`) **n'a AUCUNE colonne établissement**.
- Le lien est **déduit du `mode`** via un mapping codé en dur `MODE_VERS_CLE`, présent en **double** :
  - `apps/svc-notifications/src/etablissement/etablissement.dto.ts:68-75` (+ `cleEtablissementPourMode`)
  - `apps/api-gateway/src/bff/semaine-besoins.ts:33-38`
  - Mapping : `CRECHE_PSU → CRECHE_HIRONDELLES` ; `CANTINE/PERISCOLAIRE/ALSH → ABCM`

### CRUD & écran actuels (partiels)

- Service : `GET /api/etablissements`, `PUT /api/etablissements/:cle` (upsert email + préavis + libellé) — `apps/svc-notifications/src/etablissement/etablissement.controller.ts`
- BFF : `GET /api/v1/etablissements`, `PUT /api/v1/etablissements/:cle` — `apps/api-gateway/src/bff/notifications.controller.ts`
- Web : `apps/web/src/etablissements/EtablissementsPage.tsx` + `useEtablissements.ts` + `apps/web/src/api/client.ts`
- **Manques** : pas de création, pas de suppression, pas de coordonnées, pas de types, pas de portée foyer, identité (clé) figée.

### Contrats (rappel des chemins)

- Domaine/persistance : `apps/svc-planification/src/planification/` (service `planification.service.ts:115-169` `creerContrat`), schéma DTO `planification.dto.ts:69-72` (union discriminée crèche/ABCM)
- Events outbox : `planification.ContratCree.v1` / `ContratModifie.v1` / `ContratSupprime.v1`
- BFF : `apps/api-gateway/src/bff/contrats.controller.ts` ; client `apps/api-gateway/src/clients/planification.client.ts`
- Web : `apps/web/src/foyer/ContratsPage.tsx`, `ContratForm.tsx`, `useContrats.ts`
- Projection notifications : `apps/svc-notifications/src/database/schema.ts:40-55` (table `contrat` read-model, consumer du stream `PLANIFICATION`)

---

## 3. Modèle cible

### Nouvelle table `etablissement` (svc-planification, base planification)

```
etablissement
  id            uuid PK
  foyer_id      uuid NOT NULL            -- portée par foyer
  nom           varchar(200) NOT NULL
  email_service varchar(320)             -- destinataire récap (peut être null tant que non renseigné)
  preavis_regle jsonb                    -- union discriminée JOURS_OUVRES | JOUR_HEURE (réutiliser le schéma existant)
  types         jsonb NOT NULL DEFAULT '[]'  -- sous-ensemble de MODES_CONTRAT proposés par l'établissement (informational)
  adresse       varchar(...) | jsonb     -- coordonnées/contact (adresse, téléphone, référent) — forme à arrêter en P1
  telephone     varchar(...)
  contact       varchar(...)
  actif         boolean NOT NULL DEFAULT true
  created_at / updated_at
  UNIQUE (foyer_id, nom)                 -- unicité du nom par foyer (dédoublonnage de la création à la volée)
```

> Affiner la forme des « coordonnées » en P1 (colonnes plates vs un `jsonb contact`). Réutiliser `preavisRegleSchema` (déplacé/partagé) plutôt que le redéfinir.

### Modification table `contrat`

```
+ etablissement_id uuid REFERENCES etablissement(id)   -- nullable en P2, NOT NULL visé après migration P5
```

### Events NATS (nouveaux, émis par svc-planification via outbox)

- `planification.EtablissementCree.v1`, `EtablissementModifie.v1`, `EtablissementSupprime.v1` (ou `Archive`)
- Payload : `id`, `foyerId`, `nom`, `emailService`, `preavisRegle`, `types`, `actif`
- Consommés par `svc-notifications` → projection (remplace la table source actuelle).

---

## 4. Découpage en phases / PR

> Chaque phase = 1 PR, branche depuis `main`, check `ci` requis. Convention repo : `corepack pnpm@10.34.2`, lint ESLint 9 flat type-aware (ratchet warn→error), `verbatimModuleSyntax` web-only, `nx run-many -t typecheck test -p <projet>` (⚠️ `nx test` seul ne typecheck pas), Pact + drift OpenAPI à garder verts.

### P1 — Modèle établissement (backend isolé)

**But** : créer l'entité dans `svc-planification` sans rien câbler côté contrat/notif/web.

- Migration Drizzle : table `etablissement` (cf. §3) + schéma `apps/svc-planification/src/database/schema.ts`.
- Module/service CRUD : `lister(foyerId)`, `parId(id)`, `creer(foyerId, dto)`, `modifier(id, dto)`, `supprimer(id)` (avec garde « bloqué si contrats rattachés » — stub jusqu'à P2, ou via comptage), `archiver(id)`.
- DTO Zod (nom, emailService opt, preavisRegle opt, types[], coordonnées). Partager `preavisRegleSchema` (extraire dans une lib `contracts-planification` ou similaire pour réemploi notif/BFF).
- Events outbox `EtablissementCree/Modifie/Supprime` (réutiliser le pattern outbox existant `planification.service.ts`).
- Endpoints service : `GET/POST /api/etablissements?foyer=`, `GET/PUT/DELETE /api/etablissements/:id`.
- Tests unitaires service + domaine.
- **Isolé** : aucun autre service ne dépend encore de ces tables/events. Rien en prod ne change.

### P2 — Lien contrat ↔ établissement + création à la volée

**Prérequis : P1.**

- Migration : `ALTER TABLE contrat ADD COLUMN etablissement_id uuid REFERENCES etablissement(id)` (**nullable** à ce stade).
- DTO création/édition contrat : accepter `etablissementId` (existant) **OU** `nouvelEtablissement` (objet → création inline). Union/refine Zod.
- `creerContrat` / `modifierContrat` : si `nouvelEtablissement`, créer l'établissement **dans la même transaction** que le contrat (atomique) ; sinon valider que `etablissementId` existe et appartient au foyer.
- Inclure `etablissementId` dans les events `ContratCree/Modifie.v1` (versionner si nécessaire).
- Garde suppression établissement : `DELETE /api/etablissements/:id` → **409/erreur métier** si au moins un contrat le référence.
- BFF + client gateway : relayer les nouveaux champs ; endpoints établissements per-foyer côté gateway (`/api/v1/etablissements?foyer=`).
- Tests : création contrat avec établissement existant, avec création à la volée, suppression bloquée.

### P3 — Projection & routage notifications

**Prérequis : P1, P2.**

- `svc-notifications` : nouveau consumer des events `Etablissement*` → table projection (remplace `etablissement_destinataire` comme **source** ; garder une table read-model keyée par `id`/`foyer_id`).
- **Supprimer le seed en dur** (`etablissement.service.ts:46-59`) et le `onApplicationBootstrap`.
- Récap hebdo : router via le **lien explicite `contrat.etablissement_id`** au lieu de `MODE_VERS_CLE`. Adapter le read-model `contrat` (ajouter `etablissementId`).
- `apps/api-gateway/src/bff/semaine-besoins.ts` : remplacer la résolution `MODE_VERS_CLE` par l'`etablissementId` porté par le contrat ; `etablissementCle` (enum) → `etablissementId` (string libre).
- Tests : agrégation hebdo groupée par établissement réel ; envoi récap au bon e-mail.

### P4 — Web (refonte écran + intégration formulaire contrat)

**Prérequis : P1–P3 (au moins les endpoints BFF).**

- `EtablissementsPage` : passer **per-foyer**, CRUD complet (créer / éditer nom + e-mail + préavis + coordonnées + types / supprimer avec garde / archiver). Sélecteur de foyer cohérent avec le reste de l'app (cf. feature parents-foyer).
- `ContratForm` : **sélecteur d'établissement** (liste du foyer) + option **« créer un nouvel établissement »** inline.
- Mettre à jour `apps/web/src/api/client.ts`, hooks, types `apps/web/src/types/bff.ts`.
- Types générés OpenAPI (`openapi-types.gen.ts`) régénérés (job CI `openapi-types-drift`).

### P5 — Migration des données prod

**Prérequis : P1–P4.**

- Script de back-fill idempotent (style `scripts/backfill-parents.mjs`, dry-run d'abord) :
  - Pour chaque foyer, pour chaque groupe de mode présent dans ses contrats, **créer un établissement** (nom par défaut = libellé actuel correspondant — « Crèche Les Hirondelles » / « École ABCM » — à **renommer ensuite par l'utilisateur**), en reportant `email_service`/`preavis_regle` depuis les 2 fiches globales actuelles.
  - **Rattacher** chaque contrat existant à l'établissement de son foyer (via le mapping `mode→groupe` actuel).
- Vérifier : tout contrat prod a un `etablissement_id` non null après run.
- (Optionnel après bascule) rendre `contrat.etablissement_id` `NOT NULL`.

### P6 — Nettoyage / démantèlement de l'ancien modèle

**Prérequis : P5 passé en prod.**

- Supprimer : `MODE_VERS_CLE` (les 2 copies), `cleEtablissementPourMode`, `CleEtablissementPipe`, `CLES_ETABLISSEMENT`, l'ancienne table `etablissement_destinataire` (migration de drop), les endpoints `:cle`.
- Mettre à jour **OpenAPI**, **contrats Pact** (`apps/api-gateway/src/contract/notifications.consumer.pact.spec.ts:28` utilise `CRECHE_HIRONDELLES`), types web générés.
- Vérifier CI verte (drift OpenAPI, Pact can-i-deploy, config-validation si compose touché).

---

## 5. Risques & points d'attention

- **Énumération diffuse** : `CleEtablissement` est dans DTO + Zod + OpenAPI + **Pact** + types web générés. Le démantèlement (P6) est la partie la plus dispersée → la garder en dernier pour CI verte.
- **Migration prod** : il y a de vrais contrats. Back-fill idempotent + dry-run obligatoire avant exécution. Noms par défaut = anciens libellés (placeholders, renommés ensuite).
- **Atomicité création à la volée** : le nouvel établissement et le contrat doivent être créés dans la **même transaction** (sinon contrat orphelin / établissement fantôme).
- **Cross-service** : ne PAS faire pointer un contrat (planification) vers un établissement vivant dans notifications. C'est précisément pourquoi on déplace la propriété en planification (P1) avant le lien (P2).
- **Préavis partagé** : extraire `preavisRegleSchema` dans une lib partagée pour éviter une 3ᵉ copie.
- **Pièges connus repo** (mémoire) : `nx test` ne typecheck pas → `nx run-many -t typecheck test -p <projet>` ; specs e2e `*.stack.e2e.spec.ts` sensibles aux libellés/données seedées ; `ReadonlyArray<T>`→`readonly T[]` (lint) ; working tree partagé → merges 100% server-side.

---

## 6. Ordre d'exécution

`P1 → P2 → P3 → P4 → P5 → P6` (séquentiel ; P2/P3 dépendent de P1, P4 des endpoints P1–P3, P5 de tout, P6 après bascule prod de P5). Livraison **d'un bloc** : les noms de test disparaissent une fois P5 migrée + renommage utilisateur via l'écran P4.
