# Plan d'exécution — SFD 33 « Planning famille : qui fait quoi, où, avec qui »

> **Statut** : brouillon — à valider PO (SFD `docs/33-sfd-planning-famille.md` en attente de validation). **GELÉ** tant que le plan 31 lots 1-3 **et** le plan 32 lots 1-3 ne sont pas mergés (dépendances dures : route calendrier, service `svc-famille`, engagements travail/absences). Dernier chantier de la séquence famille ; ordre inter-plans recommandé : consolidation (B/C/D) → SFD 31 → SFD 32 → **SFD 33** → factures réelles.
> **Dépendances (état réel au 2026-07-30)** :
>
> - Plan 32 lots 1-3 (`.claude/plans/travail-conges-revenus.md`) : **NON LIVRÉ** — aucun `apps/svc-famille`, `libs/famille`, `libs/contracts/famille` dans le dépôt. Bloquant pour les 5 lots (module travail, consumer FOYER, base famille, entrée `providersPact`). Réserve inter-plans : le consumer FOYER que le lot 1 « étend » doit être conçu **extensible dès le plan 32** (read-model `membre` partagé) — sinon ce plan devra le remanier.
> - Plan 31 lots 1-3 (`.claude/plans/calendriers-vacances-scolaires.md`) : **NON LIVRÉ** — la route `GET /api/etablissements/:id/calendrier` n'existe nulle part (seule route « calendrier » du code : `GET calendrier/jours-non-facturables`, `apps/svc-referentiel/src/referentiel/referentiel.controller.ts:49`). Bloquant lot 1 (contexte de jour, CA3) et lot 4 (CF-02/CF-03).
> - Plan 30 : **LIVRÉ 7/7, prod `0.14.0` (2026-07-29)** — y compris le lot 4 (contrat de garde **versionné à date d'effet**, événements `ContratCree.v2`/`ContratModifie.v2`) et le lot 7 (modes consolidés). Conséquence : D1 est **révisé** (voir §3). Le correctif #257 (PK surrogate de la projection `grille_tarifaire`) est mergé main `9818302` mais **pas déployé** : le train de release qui portera ce chantier (ou un train antérieur — cf. lot R1 du plan `consolidation-ui-et-qualite.md`, préalable universel) doit inclure son **rejeu de projection prod** (≠ simple restart).
> - Chantier « confiance & quotidien » : **LIVRÉ prod `0.14.0`** — les patrons UI cités existent (`LigneIndisponible.tsx`, `Modale.tsx`, `.table-defilante`).
> - Lot C0 du plan consolidation (« atterrir la nav mobile ») : la copie de travail porte un remaniement **non commité** de l'Entete (`App.tsx`, `App.test.tsx`, `styles.css`, `BarreStatutCalendrier.tsx`) — repli sur le foyer mémorisé, `PAGES_GLOBALES_DU_PANNEAU`, barre du bas rendue aussi sur les pages globales. **Préalable de D7** : l'onglet « Famille » suit ce nouveau comportement.
>   **Repères de lignes** : relevés le 2026-07-30 sur main `9aee291` **+ copie de travail non commitée** (`App.tsx`/`App.test.tsx`/`styles.css` en cours de remaniement : les repères nav rebougeront au commit). Si un numéro a dérivé, chercher le **symbole** (`.nav-onglets`, `RangeeJour`, `.jour-rangee`, …).
>   Ce plan est auto-portant.

## 1. Contexte et objectif

Chaque membre du foyer a son planning en silo (enfants côté garde, parents nulle part avant la SFD 32). Objectif : une **vue commune** jour/semaine — qui est où, qui dépose/récupère, avec qui — et un système qui **détecte les jours incohérents** (enfant sans solution, vacances sans plan, trajet impossible), acquittables avec motif.

Ancrages code :

- Le module `travail` de `svc-famille` (plan 32, **à créer**) possédera les engagements travail/absences **en local** — c'est la raison du choix d'un service unique (H5 du plan 32).
- Les engagements de garde d'un enfant se dérivent des prestations planification : patron existant de lecture inter-services = client de repli REST avec assertion machine (`apps/svc-tarification/src/fallback/planification.client.ts` — `entetesAssertionMachine` + `CircuitBreaker`/`executerOuRepli`/`fetchAvecTimeout` de `@creche-planner/resilience` + métrique OTel de repli ; svc-notifications a le sien, `apps/svc-notifications/src/fallback/planification.client.ts`). `PlanningModifie.v1` ne transporte que `{contratId, mois, simule}` (`libs/contracts/planification/src/lib/events/planification-events.ts:109-117`) — la matière se lit par REST, pas par événement.
- Le **contrat de garde est versionné à date d'effet** depuis le plan 30 lot 4 : `ContratCree.v2` (`planification-events.ts:89`) et `ContratModifie.v2` (`:174`) portent `versionId` + `dateEffet` ; mode et établissement **peuvent changer par avenant**. Les gestes chirurgicaux non versionnés (`rattacherEtablissement`/`rattacherEnfant`, projection prénom) continuent d'émettre la v1 — les projections acceptent les deux (commentaire du contrat, `:167-172`).
- Le contexte de jour (vacances, férié, fermeture) vient du calendrier d'ouverture (plan 31, route `GET /api/etablissements/:id/calendrier` — **inexistante aujourd'hui**, portée par svc-planification selon H4 du plan 31, cohérent avec D1).
- Côté web, il n'existe **aucune grille matricielle « semaine 7 colonnes »** hors FullCalendar (aucun `repeat(7` dans `apps/web/src`) ; le patron le plus proche est `.jour-rangee` (`apps/web/src/styles.css:1304`, grid 3 colonnes `auto minmax(0,1fr) minmax(4.75rem,auto)`) et le navigateur de semaine ISO est à créer (`semaineIsoDeDate`/`joursDeLaSemaine` de `@creche-planner/shared-semaine`, `libs/shared/semaine/src/lib/semaine.ts:96` et `:67`).
- La barre d'onglets quotidienne (`.nav-onglets`, `App.tsx:317` dans la copie de travail) porte **4 items** : Aujourd'hui / Planning (+`PastilleAValider`) / Coûts / bouton « Plus » (panneau `.nav-plus-panneau`, `:369`) — la vue famille y gagne sa place (5e onglet, D7). Le foyer actif de la barre se résout désormais `idRoute ?? cache ?? premier foyer autorisé` (repli mémorisé, travail non commité) : l'onglet Famille doit suivre.
- Les routes foyer sont **imbriquées** sous `/foyers/:foyerId` via `GardeFoyer` (`App.tsx:631-641`) ; la route `famille` du D7 sera un enfant de ce bloc, et son titre s'ajoute à `titreDepuisPathname` (`:563`).

## 2. Hypothèses assumées (réponses aux questions ouvertes — à corriger par le PO si faux)

> ⚠️ La SFD 33 est encore « Brouillon à valider PO » : **aucune de ces hypothèses n'a été validée**. Au GO du chantier (levée du gel), les re-signaler explicitement au PO, avec en plus : la définition d'« enfant scolarisé » pour CF-03 (quels modes de contrat ⇒ scolarisé ? les modes consolidés sont `MODES_CONTRAT`, `libs/contracts/kernel/src/lib/modes.ts:11`), et le jour/heure du mail conflits (lot 5).

- **H1** (Q-33-01) : paramètre « télétravail = disponible » **global au foyer**, deux réglages distincts conformes RM-33-03 : `teletravailDisponibleTrajets` (défaut oui) et `teletravailDisponibleGarde` (défaut non). Pas de réglage par créneau en v1.
- **H2** (Q-33-02) : pas d'engagement récurrent propre aux enfants en v1 — un événement libre suffit, sa répétition est manuelle (backlog).
- **H3** (Q-33-03) : pas de mode « planification de vacances » dédié en v1 — CF-03 + acquittement couvrent le besoin ; le deep-link planning fait le reste.
- **H4** : la vue agrège les données **réelles** uniquement (`simule=false`) — la simulation reste dans le planning.
- **H5** : « membre du foyer » v1 = parents + enfants du foyer (read-model du stream FOYER) ; le modèle n'empêche pas un futur membre invité (RM-33-01 : les règles portent sur les engagements, pas sur les sources).
- **H6** : fraîcheur : la vue lit les prestations de garde **à la demande** (REST planification) et non par projection — cohérent avec CA4 US-32-02 (« le jour même de sa saisie ») et avec le volume mono-foyer. Les conflits sont donc **évalués à la lecture** ; seule leur _notification_ hebdomadaire est calculée en tâche planifiée. Aucune table de conflits matérialisée — l'acquittement est persisté par **clé de conflit déterministe**. ⚠️ Cette hypothèse a un coût : 1 `GET /planning` = N contrats × 1-2 mois de prestations + 1 calendrier par établissement, en synchrone — voir le budget de latence au lot 1 et le garde-fou du tick au lot 5.
- **H7** : aucune nouvelle dépendance npm.

## 3. Décisions structurantes

- **D1 — module `planning/` dans `svc-famille`** : agrégation + données propres. Read-models locaux :
  - `membre` (projection du stream FOYER : parents + enfants — partagé avec le module travail du plan 32, d'où la réserve « consumer extensible » de l'en-tête) ;
  - `contrat_garde` **projeté PAR VERSION** (révision post-plan 30 : une ligne plate par contrat est fausse sur une semaine à cheval sur une date d'effet). Colonnes : `contrat_id`, `version_id`, `foyer_id`, `enfant_id`, `enfant`, `mode`, `etablissement_id`, `date_effet`, `valide_du`/`valide_au` ; **PK surrogate** + unique `(contrat_id, version_id)` — leçon du défaut #257 : jamais un id métier partagé comme PK de projection. Alimentation : `ContratCree.v2`/`ContratModifie.v2` (upsert de la version) ; **tolérance v1** pour les gestes chirurgicaux non versionnés (`rattacherEtablissement`/`rattacherEnfant`, prénom) : mise à jour transversale des champs concernés sur toutes les versions du contrat. La résolution « quel mode/établissement tel jour » = sélection de la version applicable à la date (patron `selectionnerVersionApplicable`, `libs/shared-kernel/src/lib/versionnement.ts`).
    La matière des jours (prestations, saisies) se lit par client REST planification avec assertion machine (patron tarification) — les prestations **reflètent déjà les versions**, le read-model ne sert qu'à savoir _quoi_ interroger et à libeller. Calendrier : client REST planification également (route du plan 31 — **figer son contrat de lecture avec le plan 31 lot 1**, c'est un client inter-services sans pact).
- **D2 — modèle d'engagement unifié** (SFD §2) : `Engagement = { membreId, jour, creneau?, categorie: ACCUEIL|TRAVAIL|ABSENCE|TRAJET|EVENEMENT, libelle, lieu?, source: DERIVE|SAISI, refSource, participants? }`. Construit en mémoire par un agrégateur pur (`libs/famille/domain/src/lib/engagements.ts`) à partir des sources — ajouter une source ne change pas les règles (RM-33-01).
- **D3 — tables propres (svc-famille)** : `trajet` (`id`, `foyer_id`, `enfant_id`, `jour`, `sens` (`DEPOSE`|`RECUPERATION`), `parent_id` NULL, `heure_minutes` NULL ; unique `(enfant_id, jour, sens)`), `trajet_semaine_type` (`id`, `foyer_id`, `enfant_id`, `jour_semaine`, `sens`, `parent_id` — base proposée, ajustée par jour, CA2 US-33-03), `evenement` (`id`, `foyer_id`, `libelle`, `jour`, `creneau` jsonb NULL, `participants` jsonb — membreIds, `accompagnant_requis` bool), `acquittement_conflit` (`id`, `foyer_id`, `cle` varchar — déterministe `CF-XX:jour:membreId|contexte`, `motif`, `acquitte_le` ; unique `(foyer_id, cle)`), `parametre_foyer_famille` (`foyer_id` PK, `teletravail_trajets` bool default true, `teletravail_garde` bool default false). Numérotation des migrations : suit la numérotation **réelle** issue du plan 32 ; toutes les migrations restent **additives** (condition du rollback auto de `deploy.mjs`).
- **D4 — moteur de conflits = catalogue de prédicats purs** (`libs/famille/domain/src/lib/conflits.ts`) : CF-01→06 de la SFD §6, signature commune `(jour, engagements, contexteJour, parametres) → Conflit[]`. « Disponible » selon RM-33-03/H1. Un conflit porte une `cle` déterministe (D3) : réévalué à chaque lecture, il disparaît de lui-même si les engagements changent ; son acquittement (RM-33-02) reste et est ignoré si la clé ne matche plus.
- **D5 — API d'agrégation** : `GET /api/famille/planning?foyer=&semaine=YYYY-Www` → `{ jours: [{ iso, contexte, membres: [{ membreId, engagements }], conflits: [{ cle, regle, membres, description, acquittement? }] }] }`. Une route, la vue jour est un cas particulier de la semaine côté front.
- **D6 — notification hebdo des conflits** (CA2 US-33-05) : scheduler dédié dans svc-notifications (patron `scheduler.hebdo.ts`) + client famille (nouvelle route de synthèse `GET /api/famille/conflits?foyer=&horizonSemaines=`), type `CONFLITS_FAMILLE` ajouté à `TYPES_NOTIFICATION`. **DÉCISION ACTÉE (inter-plans)** : le lot 5 du plan 31 (« vacances sans solution ») est **RETIRÉ** — aucun scheduler vacances n'existe dans le code (`apps/svc-notifications/src/scheduler/` = hebdo/récap/options/clock uniquement), et ce lot-ci est **l'unique implémentation** de l'alerte vacances : CF-03 la recouvre (US-33-05 CA2 « inclut l'alerte de US-31-05 »), clé d'acquittement par période. Aucun type transitoire `VACANCES_SANS_SOLUTION` ne doit exister (le retrait d'un type de `TYPES_NOTIFICATION` n'est PAS un simple revert : l'enum est dupliqué/projeté en 4 points, voir lot 5). Ce retrait est écrit **dans les deux plans** (cf. `.claude/plans/calendriers-vacances-scolaires.md`) ; si le PO exige l'alerte avant ce chantier, la livrer directement sous la forme du lot 5 ci-dessous (checklist enum complète).
- **D7 — UI : onglet quotidien « Famille »** (📆), **5e item** de `.nav-onglets` (`App.tsx:317`), route `/foyers/:foyerId/famille?semaine=` **enfant du bloc `GardeFoyer`** (`App.tsx:631-641`) + entrée dans `titreDepuisPathname` (`:563`). Préalable : lot C0 de consolidation (nav mobile non commitée atterrie) — l'onglet suit la logique de **repli foyer mémorisé** (`id = idRoute ?? cache ?? moi.foyers[0]`, `App.tsx:282-285`), pas seulement la route. Si C2 (découpage App.tsx) a été fait, l'onglet s'ajoute dans le module nav dédié. Mobile 375 px : vue **jour** par défaut (une carte par membre, engagements ordonnés) avec navigation jour/semaine ; ≥ 768 px : grille membres × 7 jours (CSS Grid maison, scroll horizontal borné patron `.table-defilante`, `styles.css:445`). L'état (semaine, jour déplié) vit dans l'URL (`useSearchParams`, patron PlanningPage). ⚠️ À 375 px, 5 onglets ⇒ ~75 px chacun (`flex 1 1 0`, libellés 0.72rem) : troncature et position de la pastille Planning à vérifier par test automatisé (critère lot 1).

## 4. Conventions transversales

Identiques au plan `versionnement-dates-effet.md` §4. Spécifiques à ce chantier :

- Libellés 100 % langage parent (CA2 US-33-01 — noms d'établissements du foyer, `libelleMode` de `apps/web/src/utils/libelles.ts`, jamais de code technique) ; RM-33-04 : la vue est en lecture agrégée, modifier un engagement dérivé = deep-link vers son écran source (patron `RangeeJour`, déclaré `DashboardJourPage.tsx:78`, commentaire deep-link P3a `:110`).
- **Critère commun à chaque lot exposant une route BFF** (lots 1 à 4 : planning, trajets, événements, conflits/paramètres) : `gatewayOpenApiDocument` mis à jour (`libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts`) **+ oracle du nombre de routes incrémenté** (`gateway.openapi.spec.ts:14`, « expose exactement les 27 routes attendues » au 2026-07-30) **+ `apps/web/src/api/openapi-types.gen.ts` régénéré** (`pnpm nx run web:generate-types`, script `scripts/generate-openapi-types.mjs`) **+ pacts régénérés sans dérive**. Les jobs CI `pact-drift` (`.github/workflows/ci.yml:544`) et drift OpenAPI (`ci.yml:581+`) sont bloquants.
- **Sécurité inter-services dès le premier commit** : la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` (observe→enforce, fenêtre « 1 semaine de logs propres » post-train R1) arrivera **pendant** ces chantiers. Tout nouveau client inter-services (famille→planification aux lots 1-2, notifications→famille au lot 5) porte `entetesAssertionMachine` + propagation des foyers autorisés (PR #264) ; `svc-famille` embarque `AssertionIdentiteModule` (posé par le plan 32 lot 1 — vérifier). Un client livré observe-only serait cassé net à la bascule.
- **Scoping des écritures sans `?foyer=`** : les routes `PUT /trajets/:enfantId/...`, CRUD `/evenements`, `POST /conflits/acquitter` se scopent par **résolveur local** ressource→foyer : `@ScopeFoyerInterServices({ resoudre: ..., param: ... })` + `ResolveurFoyerRessource` fourni à `AssertionIdentiteModule.forRoot({ scoping })` (`libs/nest-commons/src/lib/security/scope-foyer.decorator.ts:62`, patron `resoudre: 'contrat'` documenté `:29`). Contrat d'erreur explicite (404 ressource inconnue vs 403 hors foyer) + **un test de non-appartenance par route**. Côté BFF : `@FoyerScope` (`apps/api-gateway/src/security/foyer-scope.ts`).
- **Invalidation du cache web après CHAQUE écriture** (lots 2, 3 et 4 — pas seulement le `reload()` du lot 4) : le cache est celui de `useAsync` (`apps/web/src/hooks/useAsync.ts`), clé `famille:${foyerId}:${semaine}` — invalider **toutes les semaines affectées** (un trajet « appliquer à tous les mardis » touche potentiellement plusieurs semaines en cache).
- **Séquencement** : ne jamais mener ce chantier en parallèle d'un autre — `gateway.openapi.ts`, `openapi-types.gen.ts`, les pacts, `scripts/services.json` et `TYPES_NOTIFICATION` sont des surfaces partagées à fort taux de conflit.

## 5. Vue d'ensemble des lots

| #   | Lot                                                                     | Dépend de                                                | Modèle                 |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------- |
| 1   | Agrégation d'engagements + vue jour/semaine lecture seule (US-33-01/02) | plan 32 lots 1-3, plan 31 lots 1-3, lot C0 consolidation | Opus 4.8               |
| 2   | Trajets dépose/récupération (US-33-03)                                  | 1                                                        | Opus 4.8               |
| 3   | Événements libres multi-participants (US-33-04)                         | 1                                                        | **délégable Sonnet 5** |
| 4   | Conflits CF-01→06 + acquittement (US-33-05 CA1/CA3)                     | 1, 2 (CF-04/05), 3 (CF-06 événements)                    | Opus 4.8               |
| 5   | Notification hebdo des conflits (US-33-05 CA2)                          | 4                                                        | Opus 4.8               |

Ordre : 1 → 2 → 3 → 4 → 5 (2 et 3 parallélisables après 1). Préalables hors plan : train de release n°16 (lot R1 du plan consolidation — #257 rejeu projection, #264, activation A2/A6/A7) exécuté **avant** tout chantier ; lot C0 (nav mobile) mergé.

---

## Lot 1 — Agrégation + vue jour/semaine lecture seule

**Modèle : Opus 4.8.**

### Objectif

US-33-01/02 : le mardi scolaire de référence s'affiche — enfant 1 « École + cantine + périscolaire soir », enfant 2 « Crèche 8h30–16h30 », parent A « Travail (domicile) », parent B « Travail (site) 8h–12h » — avec le contexte du jour (« Vacances de printemps », « Férié »), en vue jour (375 px) et semaine (grille).

### Périmètre exact

- svc-famille (migration `000N` — numérotation réelle issue du plan 32) : read-models `membre` + `contrat_garde` **par version** (D1) — extension du consumer FOYER posé par le plan 32 + abonnement PLANIFICATION (`ConsumerModule` : ajouter `{ stream: 'PLANIFICATION', durable: 'famille-planification' }`, patron `apps/svc-tarification/src/consumers/consumers.module.ts:8-10`). Consommer `ContratCree.v2`/`ContratModifie.v2`, tolérance v1 (D1).
- **Volet bootstrap prod** : le durable `famille-planification` ne rejouera que les événements **retenus** par le stream NATS PLANIFICATION — les contrats prod existants (8) peuvent précéder la rétention. Prévoir un **backfill explicite** (patron `scripts/backfill-parents.mjs`/`backfill-enfants.mjs`/`backfill-etablissements.mjs`) ou un repli REST à froid (patron tarification). Critère vérifiable : après déploiement sur base vide, `membre`/`contrat_garde` se peuplent et `GET /planning` renvoie les engagements des contrats prod existants — sinon la page famille sera vide au premier déploiement.
- Clients de repli (patron `apps/svc-tarification/src/fallback/planification.client.ts` : assertion machine + resilience + métrique OTel de repli) : `planification.client.ts` dans svc-famille — `prestations(contratId, mois)` et `calendrier(etablissementId, du, au)`. Le contrat de lecture du calendrier est **figé avec le plan 31 lot 1** (client inter-services sans pact). Propagation des foyers autorisés (#264) dès le premier commit (cf. §4).
- `libs/famille/domain` : `engagements.ts` (D2) — dérivations : prestations garde → `ACCUEIL` (libellé par mode consolidé `MODES_CONTRAT` + établissement, résolus par la **version applicable au jour**), semaine travail résolue + exceptions → `TRAVAIL` (lieu), absences → `ABSENCE`/`CONGE`/`MALADIE` (libellé du type), contexte de jour depuis le calendrier.
- svc-famille : `GET /api/famille/planning?foyer=&semaine=` (D5), scoping foyer (`@ScopeFoyerInterServices({ query: 'foyer' })`). BFF : `famille.controller.ts` (dans `apps/api-gateway/src/bff/`) `GET /api/v1/foyers/:foyerId/famille/planning?semaine=` + client + pact `famille.consumer.pact.spec.ts` (patron `ETAT_*` des 5 specs existants de `apps/api-gateway/src/contract/`) avec état `ETAT_PLANNING_FAMILLE` seedant membre/contrat/travail — le provider-state handler côté svc-famille **et** l'entrée `svc-famille` dans `providersPact` de `scripts/services.json` doivent exister (posés par le plan 32 lot 1 — **vérifier avant de démarrer**, sinon le job pact-drift casse).
- Web : `apps/web/src/famille/FamillePage.tsx` (+ `VueJourFamille`, `GrilleSemaineFamille`, `NavigateurSemaine` — `semaineIsoDeDate`/`joursDeLaSemaine`), onglet « Famille » dans la nav (D7 : repli foyer mémorisé, `titreDepuisPathname`, mise à jour d'`App.test.tsx` — déjà en remaniement non commité), `api.lirePlanningFamille` (`requeteIdempotente`, `client.ts:187` ; cache `famille:${foyerId}:${semaine}`), CSS grille (variables `--esp-*`, cibles 44 px).
- Seed : étendre `scripts/seed-demo.mjs` **et** le seed e2e-stack avec le « mardi de référence » (parents + engagements travail + données famille) — l'e2e stack est destructive, ne pas casser les 12 specs `*.stack.e2e.spec.ts` existants de `apps/web/e2e/`.
- **Hors périmètre** : trajets, événements, conflits (badges absents), toute écriture.

### Critères d'acceptation

- Le mardi de référence (seed) s'affiche exactement comme CA1 US-33-01 ; libellés = langage parent + noms d'établissements (CA2) ; contexte de jour visible (CA3).
- 375 px : vue jour lisible, un jour dépliable en vue semaine (CA1 US-33-02) ; ≥ 768 px : grille membres × jours complète. **Test automatisé de la barre à 5 onglets à 375 px** (troncature des libellés, position de la pastille Planning).
- Navigation semaine ← → fluide (URL source de vérité, back/forward OK).
- **Budget de latence testé sur seed** : `GET /planning` d'une semaine < 1 s (lectures prestations/calendrier parallélisées, timeouts de `@creche-planner/resilience`).
- Panne de svc-planification → la colonne garde affiche « indisponible » discret (patron `apps/web/src/ui/LigneIndisponible.tsx`), le reste s'affiche.
- Bootstrap : critère du volet ci-dessus (read-models peuplés après déploiement à froid).
- Critère OpenAPI/pact du §4 (oracle 27→28 routes, types régénérés, pacts verts) ; `corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p famille-domain svc-famille api-gateway web` vert.

### Pièges connus

- Les prestations se lisent par mois : une semaine à cheval sur deux mois = deux lectures — le client famille les fusionne (piège classique du repo, cf. `ecrireSemaineBesoins`, `apps/web/src/api/client.ts:600`).
- Une semaine à cheval sur une **date d'effet** de version : mode/établissement changent en cours de semaine — résoudre la version **par jour**, jamais par semaine (D1).
- Le mercredi ALSH et les vacances viennent du calendrier + saisies — ne pas réinventer de règle « mercredi » en dur (tout est donnée depuis le plan 31).
- `viderCacheAsync()` est déjà appelé globalement par le setup (`apps/web/src/test-setup.ts:19-20`) — rien à ajouter dans les tests.

---

## Lot 2 — Trajets dépose/récupération (US-33-03)

**Modèle : Opus 4.8.** Dépend du lot 1.

### Périmètre exact

- svc-famille : tables `trajet` + `trajet_semaine_type` (D3, migration additive), routes CRUD (`PUT /api/famille/trajets/:enfantId/:jour/:sens` — upsert affectation, `PUT /api/famille/trajets-semaine-type/:enfantId`), résolution effective = trajet daté sinon semaine type (CA2 : « base + exceptions », même logique que doc 32). **Scoping écriture** : résolveur local `enfantId → foyer_id` (read-model `membre`) via `@ScopeFoyerInterServices({ resoudre: ... })` + test de non-appartenance (§4).
- Domaine : le trajet devient un engagement `TRAJET` chez le parent affecté **et** l'enfant (horaire prérempli par les horaires d'accueil du jour — plage de la prestation, CA1).
- BFF + web : depuis la vue famille, tap sur un jour d'un enfant → panneau « Trajets » (dépose/récupération : sélecteur parent + horaire prérempli, bouton « Appliquer à tous les {mardi}s » → écrit la semaine type). Affichage dans la grille : pictos dépose/récup avec initiale du parent. **Après écriture : invalider le cache `famille:*` de toutes les semaines affectées** (la semaine type en touche plusieurs) puis recharger la semaine visible.
- **Hors périmètre** : le conflit CF-04/05 (lot 4) — ici on saisit et on affiche.

### Critères d'acceptation

- Affectation rapide en 2 taps depuis la vue (CA1) ; la semaine type proposée s'applique puis s'ajuste par jour sans effacer les ajustements existants (CA2).
- Le trajet apparaît chez le parent et chez l'enfant, ordonné par horaire ; la vue reflète l'écriture sans rechargement manuel (cache invalidé).
- Écriture refusée (403/404 selon le contrat d'erreur) pour un enfant hors foyer — testé.
- Critère OpenAPI/pact du §4 ; `nx run-many -t typecheck test lint -p famille-domain svc-famille api-gateway web` vert.

### Pièges connus

- L'upsert `(enfant, jour, sens)` : réaffecter écrase, `parent_id NULL` = désaffecter (pas de DELETE dédié).
- L'horaire prérempli vient de la prestation du jour (arrivée pour la dépose, départ pour la récup) — pas des horaires d'ouverture de l'établissement.

---

## Lot 3 — Événements libres multi-participants (US-33-04)

**Modèle : délégable à Sonnet 5.** Dépend du lot 1.

### Périmètre exact

- svc-famille : table `evenement` (D3, migration additive), CRUD `POST/PUT/DELETE /api/famille/evenements`. **Scoping écriture** : POST scope par `body: 'foyerId'` (ou foyer résolu des participants), PUT/DELETE par résolveur local `evenementId → foyer_id` + tests de non-appartenance (§4).
- Domaine : engagement `EVENEMENT` chez **chaque** participant (CA1) ; drapeau `accompagnant_requis` porté pour le lot 4 (CA2 = conflit, pas de blocage ici).
- BFF + web : bouton « + Événement » sur la vue famille (modale : libellé, jour, créneau optionnel, participants = cases membres, case « nécessite un accompagnant adulte »). **Après écriture : invalider le cache de la semaine du jour concerné** puis recharger.

### Critères d'acceptation

- Un « RDV pédiatre » avec enfant 2 + parent A apparaît chez les deux ; édition/suppression OK ; à 375 px la modale est un bottom-sheet (patron `apps/web/src/ui/Modale.tsx`).
- Critère OpenAPI/pact du §4 ; `nx run-many -t typecheck test lint -p famille-domain svc-famille api-gateway web` vert.

### Pièges connus

- `participants` jsonb = liste de membreIds validée contre le read-model `membre` (pas de texte libre).
- Ne pas créer de notion de récurrence (H2).

---

## Lot 4 — Conflits CF-01→06 + acquittement (US-33-05 CA1/CA3)

**Modèle : Opus 4.8.** Dépend des lots 1-3. Cœur de la valeur du chantier.

### Périmètre exact

- `libs/famille/domain/src/lib/conflits.ts` (D4) : les 6 prédicats du catalogue SFD §6 + `cleConflit` déterministe + `estDisponible(parent, creneau, parametres)` (RM-33-03/H1 : sans engagement travail sur le créneau, ou travail à domicile si le paramètre du foyer l'autorise — trajets et garde réglés séparément). Specs exhaustives par règle (matrices de cas).
- svc-famille : évaluation à la lecture dans `GET /planning` (conflits joints aux jours, acquittements appliqués), table `acquittement_conflit` + `parametre_foyer_famille` (D3, migration additive), routes `POST /api/famille/conflits/acquitter { cle, motif }`, `DELETE …` (réactiver), `GET/PUT /api/famille/parametres`. **Scoping écriture** : acquittement scope par `body` (foyer) ou clé résolue localement ; paramètres par `foyer_id` — tests de non-appartenance (§4).
- Web : badges de conflit au niveau jour et semaine (CA2 US-33-02) — **couleur + texte/picto, jamais couleur seule** ; panneau de détail par jour (description en langage parent : « Mercredi 15 : Zoé n'a ni accueil ni adulte disponible »), bouton « C'est prévu autrement » → motif (ex. « garde par la grand-mère ») → le conflit reste visible, grisé, n'alerte plus (CA3) ; réglage télétravail dans un petit écran « Réglages famille » (lien depuis la vue). Après acquittement/réglage : invalider le cache + `reload()`.
- À la saisie (CA1) : après chaque écriture (trajet, événement), le front `reload()` la semaine → les conflits créés apparaissent immédiatement, sans blocage.
- **Hors périmètre** : la notification (lot 5).

### Décisions prises

- CF-01 (« enfant sans solution ») ne se déclenche que sur les jours **ouvrés du foyer** (au moins un parent a un engagement travail) — un samedi sans engagement n'est pas un conflit.
- CF-03 (« vacances sans plan ») s'appuie sur le contexte `VACANCES` du calendrier + l'existence d'un contrat **scolaire** actif pour l'enfant — ⚠️ « scolaire » = sous-ensemble de `MODES_CONTRAT` à faire valider par le PO (question ouverte de l'en-tête §2) ; acquittable en bloc par période (un acquittement par jour serait pénible : la clé accepte `CF-03:{periodeDu}:{enfantId}` — décision d'ergonomie, motivée par H3).
- CF-06 (« chevauchement ») : deux engagements se chevauchent si leurs créneaux s'intersectent ; les engagements sans créneau (journée) chevauchent tout — sauf `ACCUEIL` vs `TRAJET` du même enfant (le trajet borde l'accueil, pas un conflit).
- RM-33-02 : l'acquittement est journalisé (motif, date) et devient inerte si la clé ne se recalcule plus (pas de purge).

### Critères d'acceptation

- Matrice de référence testée : les deux parents sur site + enfant sans accueil → CF-01 ; accueil sur jour fermé → CF-02 ; jour de vacances sans plan → CF-03 ; dépose sans parent → CF-04 ; trajet affecté à un parent en déplacement → CF-05 ; parent A télétravail + paramètre trajets=oui → **pas** de CF-05 pour un trajet, mais CF-01 possible pour la garde en journée si garde=non (H1, testé).
- Acquitter CF-03 d'une période → badge grisé, réévaluation après ajout d'un ALSH → le conflit disparaît, l'acquittement reste inerte.
- a11y : les conflits sont perceptibles sans couleur (texte/picto), la grille scrollable se parcourt au clavier, l'apparition de conflits après écriture est annoncée (région `aria-live` polie, patron des annonces de mutation existantes) ; le spec e2e inclut un **passage axe** sur FamillePage **+ balayage `getComputedStyle`** des angles morts connus d'axe (contraste focus/bordures/`:disabled`/`opacity` d'ancêtre — fiche mémoire `a11y-axe-angles-morts`).
- Critère OpenAPI/pact du §4 ; `nx run-many -t typecheck test lint -p famille-domain svc-famille api-gateway web` vert ; nouveau spec e2e `famille.stack.e2e.spec.ts` (vue + un conflit + acquittement) — pile e2e **destructive** : ne pas casser les specs existants.

### Pièges connus

- **La disponibilité ne regarde que les engagements travail/absence** (RM-33-03) — pas les événements libres (un parent « au parc » est disponible au sens v1) ; ne pas sur-modéliser.
- L'évaluation est à la lecture : attention au coût par semaine (7 jours × règles) — rester sur des structures en mémoire, pas de requête par règle.
- Les descriptions de conflits sont générées côté domaine avec les prénoms — jamais d'ID à l'écran.

---

## Lot 5 — Notification hebdo des conflits (US-33-05 CA2)

**Modèle : Opus 4.8.** Dépend du lot 4.

### Périmètre exact

- svc-famille : route de synthèse `GET /api/famille/conflits?foyer=&horizonSemaines=` (conflits non acquittés des N prochaines semaines, groupés par semaine).
- **Checklist COMPLÈTE du nouveau type `CONFLITS_FAMILLE`** (l'enum est dupliqué/projeté en plusieurs points — tous dans le périmètre) :
  1. `TYPES_NOTIFICATION` += `CONFLITS_FAMILLE` — source de vérité `libs/contracts/foyer/src/lib/events/foyer-events.ts:248` (actuellement `['VALIDATION_HEBDO','RECAP_SERVICE']`) ;
  2. enum **dupliqué en dur** à la frontière BFF : `apps/api-gateway/src/bff/bff.dto.ts:143` ;
  3. préférences svc-foyer : `apps/svc-foyer/src/foyer/preferences.util.ts` (matrice par défaut par type, `:41-50`) — défaut proposé : e-mail actif + in-app actif, migration éventuelle des lignes stockées ;
  4. UI : toggle de préférence dans `apps/web/src/profil/MonProfilPage.tsx` ;
  5. OpenAPI : `gatewayOpenApiDocument` (schémas de préférences) + `openapi-types.gen.ts` régénéré (§4) ;
  6. désabonnement : le type entre dans le mécanisme `List-Unsubscribe` existant (`apps/svc-notifications/src/desabonnement/`).
- svc-notifications : `scheduler.famille.ts` (patron `scheduler.hebdo.ts` : setInterval + réentrance + Europe/Paris (`scheduler.options.ts:10`) + slot idempotent par `(foyer, semaineIso)`), client famille (patron fallback, **assertion machine + foyers autorisés #264**), e-mail (template `conflitsFamille.ts`) + inbox (`cleIdempotence = CONFLITS_FAMILLE:${semaineIso}`), horizon `NOTIF_CONFLITS_HORIZON_SEMAINES` (défaut 4). **Anti-tempête** : s'inscrire dans le même dispositif que le récap (ledger de livraison par parent + plafond `MAX_ESSAIS_PARENT`, `scheduler.hebdo.ts:56` — le mécanisme récap est identifié « risque confiance n°1 ACTIF » en prod) ; plafond global : **2 e-mails hebdo par parent maximum** (récap mardi + conflits dimanche), aucune autre source.
- ⚠️ Garde-fou de charge : le tick = horizon (4 semaines) × foyers × lectures planification — borner la concurrence (traitement foyer par foyer, timeouts/circuit-breaker de `@creche-planner/resilience`) pour ne pas marteler svc-planification.
- **D6 acté** : ce lot est **l'unique implémentation** de l'alerte vacances (le lot 5 du plan 31 est retiré) — CF-03 recouvre son contenu, clé d'acquittement par période. Aucun type `VACANCES_SANS_SOLUTION`.
- Observabilité/ops : métriques du scheduler + alerte Prometheus (patron des schedulers existants), documentation `docs/exploitation` (variable, jour/heure d'envoi).
- Jour d'envoi : dimanche soir (le parent prépare sa semaine) — paramétrable comme l'heure du récap mardi (patron `scheduler.options.ts`). À confirmer PO (§2).
- **Hors périmètre** : canal push ; récap par conflit individuel (un seul e-mail hebdo récapitulatif).

### Critères d'acceptation

- Seed avec 2 conflits à 2 semaines → au tick du dimanche : 1 e-mail par parent (dry-run local, préférences respectées) + 1 entrée inbox avec deep-link `/foyers/:id/famille?semaine=…` ; retick → aucune duplication ; conflits tous acquittés → aucune notification.
- **Le parent peut couper `CONFLITS_FAMILLE` sans couper `VALIDATION_HEBDO`** (préférence par type testée de bout en bout : MonProfilPage → svc-foyer → scheduler) ; le lien `List-Unsubscribe` du mail conflits ne désabonne que ce type.
- Jamais plus de 2 e-mails hebdo par parent (récap + conflits), testé au niveau scheduler.
- svc-famille injoignable au tick → log + retry au tick suivant, pas de dead notification.
- Critère OpenAPI/pact du §4 ; `nx run-many -t typecheck test lint -p svc-notifications svc-famille svc-foyer contracts-foyer api-gateway web` vert.

### Pièges connus

- ⚠️ dry-run en local/tests, jamais d'envoi vers la crèche réelle — le défaut est sûr (`dryRun` vrai sauf `NOTIF_EMAIL_DRY_RUN='false'`, `apps/svc-notifications/src/config.ts:193`) ; deep-link via `NOTIF_APP_URL` (`config.ts:176`).
- L'horloge injectée (`scheduler/clock.ts`, `CLOCK`) pilote les tests ; pas de `Date.now()`.
- Oublier un des 6 points de la checklist enum casse silencieusement (préférences sans défaut, OpenAPI dérivé, toggle absent) — la checklist est le périmètre, pas une option.

---

## Récapitulatif des actions ops (PO — hors code)

1. **Préalable (hors plan, une seule fois)** : train de release n°16 = lot R1 du plan `consolidation-ui-et-qualite.md` (rejeu de projection `grille_tarifaire` #257 — ≠ restart —, /moi #264, activation A2/A6/A7), qui ouvre aussi la fenêtre « 1 semaine de logs propres » avant la bascule `INTERSERVICE_AUTHZ_ENFORCE=1`. Ce plan n'exécute pas R1, il le suppose fait.
2. Aucun nouveau secret (le service `svc-famille` et sa base datent du plan 32 — sa base postgres-famille doit être entrée dans les 4 scripts de backup via la checklist canonique du plan 32 lot 1 : `backup-all`, `restore-one`, `backup-offsite`, prune ; **vérifier**, précédent exact de l'incident #258). Variable optionnelle `NOTIF_CONFLITS_HORIZON_SEMAINES` (défaut 4) — documentée dans `docs/exploitation` avec le jour/heure d'envoi (lot 5).
3. Bootstrap après le déploiement du lot 1 : vérifier que les read-models famille sont peuplés pour les contrats prod existants (volet bootstrap du lot 1 — backfill si le stream ne couvre pas).
4. Smoke PO après le lot 4 : une semaine réelle du foyer — vérifier le mardi de référence, poser les trajets de la semaine, provoquer un CF-05 (trajet sur créneau de travail sur site) et l'acquitter.
5. Décisions produit à confirmer au moment du GO puis du lot 5 : hypothèses H1-H6 (§2, jamais validées), définition « enfant scolarisé » pour CF-03, jour/heure d'envoi du récap conflits (proposé : dimanche 18 h) — cohabitation avec le récap du mardi : **deux e-mails hebdo maximum par parent**, dans le même dispositif anti-tempête.
