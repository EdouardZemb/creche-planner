# Plan d'exécution — SFD 30 « Versionnement à date d'effet »

> **Statut** : brouillon — à valider PO (la SFD `docs/30-sfd-versionnement-dates-effet.md` est elle-même en attente de validation).
> **Socle de la séquence 30 → 31 → 32 → 33** : les plans `calendriers-vacances-scolaires.md`, `travail-conges-revenus.md` et `planning-famille.md` s'appuient sur les lots 1 et 4 de ce plan.
> **Repères de lignes** : relevés le 2026-07-19 sur main `cc8a708` (4 explorations parallèles du code réel). Si un numéro a dérivé, chercher le symbole cité, pas la ligne.
> Ce plan est auto-portant : l'exécutant n'a ni la conversation, ni la mémoire de session.

## 1. Contexte et objectif

Aujourd'hui, modifier un paramétrage **réécrit le passé** :

1. **Grilles ABCM et barème PSU** : le Référentiel possède déjà des tables versionnées (`grille_abcm`, `bareme_psu` avec `valide_du`/`valide_au`, anti-chevauchement `verifierAbsenceChevauchement`, résolution `selectionnerVersionApplicable` — `apps/svc-referentiel/src/referentiel/referentiel.service.ts:99-244`) **mais le calcul réel les ignore** : `apps/svc-tarification/src/tarification/cout.mapper.ts:174-176` (`grillePour`) lit la constante `GRILLE_ABCM_2026` (`libs/tarification/domain/src/lib/abcm/grille-abcm.ts:29-55`) indexée par tranche seulement — **aucune date n'atteint le choix de grille**. Idem PSU : `BAREME_EFFORT_PSU_2026` en dur (`bareme-effort-psu.ts:14-37`). Le read-model `grille_tarifaire` (schema tarification l.90-119) est peuplé par la projection mais **jamais lu** ; le payload `GrillePubliee` ne transporte d'ailleurs **aucun montant** (`libs/contracts/referentiel/src/lib/events/referentiel-events.ts:22-37`) — il ne le _pourrait_ pas. Le client REST `referentiel.client.ts:45-74` de tarification est écrit mais **injecté nulle part** (client mort, commentaire explicite l.31-38).
2. **Seuils de tranche RFR** : 20 000/50 000 € en dur dans `libs/shared-kernel/src/lib/tranche.ts:13-14`, seule définition du dépôt, consommée par `apps/svc-foyer/src/foyer/foyer.service.ts:711`.
3. **Contrat de garde** : un seul enregistrement, mutation en place. `modifierContrat` (`apps/svc-planification/src/planification/planification.service.ts:246-335`) est un **remplacement total** qui **supprime en cascade tous les `planning_mois` saisis** (l.305). Les prestations ne sont jamais stockées : chaque lecture recalcule avec l'état **courant** du contrat (`prestationsMois` l.794-839) → toute modification est rétroactive.
4. **Foyer** : ressources/RFR non versionnées ; la tranche est dérivée à l'émission (`foyer.service.ts:691`) et projetée telle quelle chez tarification (`foyer.tranche`, schema l.50).

Après ce chantier : toute donnée « à effet dans le temps » est une suite de versions contiguës `[dateEffet → fin)`, tout calcul daté résout ses paramètres **à la date du fait** (RM-30-01), l'avenant clôt la version précédente la veille, et la correction rétroactive est un geste **distinct, tracé et averti** (US-30-05).

## 2. Hypothèses assumées (réponses aux questions ouvertes — à corriger par le PO si faux)

- **H1** (Q-30-01) : granularité = **jour**. Un avenant en cours de journée n'a pas de sens métier.
- **H2** (Q-30-02) : les mois « communiqués » (récap envoyé) ne sont **pas verrouillés** — la correction avertit (CA3 US-30-05), elle ne bloque pas.
- **H3** (Q-30-03) : **aucune purge** de versions en v1 (rétention illimitée ; RGPD re-tranché quand le produit sera multi-foyer).
- **H4** (DV-04, périmètre réduit assumé) : v1 = **une seule source de vérité** pour les modes et la famille ABCM (fin des 3 redéfinitions de `MODES_ABCM` et des 2 unions `ModeGarde` divergentes), la politique tarifaire d'un mode devient une donnée de la grille projetée. Le « catalogue totalement ouvert » (ajouter un mode sans toucher aux types) est **différé** : l'union fermée irrigue les types OpenAPI générés du web — l'ouvrir maintenant serait un churn massif pour zéro cas d'usage réel (le foyer de référence n'a que 4 modes).
- **H5** : **pas de snapshot des prestations passées**. L'immutabilité du passé découle de la résolution versionnée : si tous les paramètres (grille, barème, contrat, foyer) se résolvent à la date du fait, recalculer un mois passé redonne le même résultat. C'est moins de machinerie qu'un magasin de snapshots et ça garde `prestationsMois` sans état.
- **H6** : le **mode**, l'**enfant** et l'**établissement** d'un contrat ne sont **pas versionnables** (en changer = nouveau contrat / geste chirurgical `rattacher*` existant). Sont versionnés : semaine type, semaine ABCM, heures annuelles, nb mensualités.
- **H7** : la **mensualité/heures annuelles** (paramètres « mensuels ») se résolvent à la version applicable au **1er du mois** ; les paramètres « journaliers » (semaine type, inscriptions) se résolvent **jour par jour**. Un avenant en milieu de mois ne proratise pas la mensualité crèche (simplicité assumée, aligné sur la pratique réelle des avenants à la rentrée).
- **H8** : aucune nouvelle dépendance npm dans tout le chantier.

## 3. Décisions structurantes (ne pas rediscuter en cours de lot)

- **D1 — la projection devient la source du calcul** (DV-01/02) : `referentiel.GrillePubliee.v2` transporte les **paramètres complets** (montants en centimes) ; la projection tarification les stocke dans la colonne `parametres` jsonb **déjà existante** de `grille_tarifaire` ; `cout.mapper` résout la grille par `(mode, tranche, date)`. **Repli** : si le read-model n'a aucune version applicable, appel REST `/grilles/applicable` via le client déjà écrit (on le branche enfin), sinon 503 — jamais de constante de secours.
- **D2 — le barème PSU et les seuils de tranche deviennent des événements** : nouveaux `referentiel.BaremePsuPublie.v1` et `referentiel.BaremeTranchesPublie.v1` (le seed PSU n'émet rien aujourd'hui). `svc-foyer` devient **consommateur** du stream REFERENTIEL (le `ConsumerModule` de nest-commons est mutualisé — coût marginal faible) pour projeter le barème de tranches et dériver la tranche **à date**.
- **D3 — contrat versionné par table de versions** : nouvelle table `contrat_version` (svc-planification), identité stable dans `contrat`. L'avenant est un `POST /contrats/:id/versions` ; l'ancien `PUT /contrats/:id` disparaît au profit d'une **correction explicite** `PUT /contrats/:id/versions/:versionId` précédée d'un aperçu d'impact. **La cascade destructive `delete(planning_mois)` est supprimée** : les saisies mensuelles survivent aux avenants et sont réinterprétées par la version applicable.
- **D4 — foyer versionné par table de versions** : `foyer_version` (ressources, RFR, nb enfants, nb parts, à date d'effet). `foyer.FoyerMisAJour.v3` porte `dateEffet` + les valeurs ; tarification projette l'historique et résout la tranche **au mois calculé**.
- **D5 — RM-30-06** : tout événement de version porte `versionId` + `dateEffet` en **v2/v3 additifs** ; les projections dispatchent par `version` d'enveloppe (patron existant `decoderFoyerMisAJour`, `apps/svc-tarification/src/consumers/projection.service.ts:124-135`).
- **D6 — traçabilité** : chaque ligne de version porte `saisi_le` (+ `motif` optionnel) ; chaque correction rétroactive écrit une ligne `correction_journal` (avant/après jsonb, motif, date). Pas de `saisi_par` en v1 (mono-foyer, l'identité est dans les logs gateway).
- **D7 — le socle de résolution temporelle est généralisé dans `shared-kernel`** à partir de l'existant `referentiel-domain` (`PeriodeValidite`, `selectionnerVersionApplicable`, `verifierAbsenceChevauchement`) — une seule implémentation pour grilles, contrats, foyer, puis contrats de travail (SFD 32).

## 4. Conventions transversales (valables pour TOUS les lots)

- **Package manager** : toujours `corepack pnpm@10.34.2 …` (jamais le pnpm global 8.x). `nx test <projet>` tire son type-check et les builds de libs (arêtes de la cible).
- **Git** : clone `creche-planner-public`, main protégée → 1 PR par lot, check `ci` vert. Commits conventionnels FR, sujet ≤ 100 chars.
- **Environnement de travail** : `pnpm preflight` en début de session — cf. [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique sur la boucle de dev.
- **Lint** : ESLint 9 flat config type-aware, ratchet warn→error ; `verbatimModuleSyntax` **web uniquement** (`import type`) ; `readonly T[]` ; `noUncheckedIndexedAccess`.
- **Pact** : fichiers commités dans `/pacts` (dans `.prettierignore`). Après toute modif de contrat : régénérer **à blanc** (`rm -f pacts/*.json` puis `nx test api-gateway`). Jobs CI `pact-drift` + `pact-can-i-deploy`.
- **Migrations** : Drizzle forward-only jouées au boot ; génération `drizzle-kit generate` **depuis le dossier du service**. Prochains numéros au 2026-07-19 : referentiel `0002`, tarification `0004`, planification `0008`, foyer `0004`, notifications `0018` — vérifier au moment du lot.
- **Événements** : versionner par type (`…v2`), jamais de rupture ; les projections acceptent vN et vN+1 pendant la transition (précédent : `FoyerMisAJour` v1/v2).
- **Ratchet de couverture** : relever les seuils des `vitest.config.mts` touchés au nouveau plancher (marge ~2 pts), jamais les baisser.
- **e2e-stack** : orchestrateur **destructif** (`down -v`) ; tout libellé visible modifié → répercuter dans `apps/web/e2e/*.stack.e2e.spec.ts`.
- **Langage parent** (web) : « avenant » se dit « changement à partir du … », « version » se dit « paramètres du … au … ». Jamais de jargon technique à l'écran.

## 5. Vue d'ensemble des lots

| #   | Lot                                                                   | Dépend de | Modèle                 |
| --- | --------------------------------------------------------------------- | --------- | ---------------------- |
| 1   | Socle « entité versionnée » (shared-kernel)                           | —         | Opus 4.8               |
| 2   | Grilles & barème PSU : la projection devient la source (DV-01/02)     | 1         | Opus 4.8               |
| 3   | Seuils de tranche versionnés + foyer à date d'effet (DV-03, US-30-03) | 1, 2      | Opus 4.8               |
| 4   | Contrat de garde versionné : avenants + résolution temporelle         | 1         | Opus 4.8               |
| 5   | UI avenants, historique, correction rétroactive (US-30-01/04/05/06)   | 4         | Opus 4.8               |
| 6   | UI publication de grille (US-30-02)                                   | 2         | Opus 4.8               |
| 7   | Consolidation des modes (DV-04 réduit, H4)                            | —         | **délégable Sonnet 5** |

Ordre recommandé : 1 → {2, 4, 7 en parallèle} → 3 → 6 → 5. Les lots 2 et 4 touchent des services différents (tarification/referentiel vs planification) et peuvent avancer de front ; leurs pactes se régénèrent **l'un après l'autre** au merge.

---

## Lot 1 — Socle « entité versionnée » dans shared-kernel

**Modèle d'exécution : Opus 4.8.** Aucune dépendance.

### Objectif

Une seule implémentation de la mécanique versionnée (période de validité, résolution à date, continuité sans trou ni chevauchement, clôture à la veille) utilisable par le Référentiel (déjà versionné), la planification (lot 4), le foyer (lot 3) et plus tard le travail (SFD 32).

### Périmètre exact

- `libs/shared-kernel/src/lib/` : nouveau module `versionnement.ts` (+ spec, + mbt.spec si invariants) — types `PeriodeValidite`, `VersionValide<T>`, fonctions `selectionnerVersionApplicable`, `verifierContinuite`, `verifierAbsenceChevauchement`, `cloreVersionPrecedente(dateEffet)` (renvoie la veille).
- `libs/referentiel/domain` : remplacer sa `PeriodeValidite`/`selectionnerVersionApplicable` locale par un ré-export/délégation vers shared-kernel (comportement identique, specs conservées).
- **Hors périmètre** : aucun changement de schéma, aucun service.

### Décisions prises

- Les dates sont des chaînes ISO `YYYY-MM-DD` comparées lexicographiquement (convention du repo entière : `valide_du varchar(10)`, `estDansPeriode` web `useCalendrierContrat.ts:181-186`). Pas d'objets Date.
- `fin` d'une version = **dérivée** (veille de la `dateEffet` suivante), jamais stockée en double quand la suite de versions est en table (le stockage `valide_au` du Référentiel existant reste tel quel — la lib accepte les deux formes via un adaptateur `depuisBornes`/`depuisSuite`).
- Erreurs typées (`ChevauchementVersionsError`, `TrouDansVersionsError`) — unions/branded types conformes aux conventions strictes.

### Critères d'acceptation

- Les specs du référentiel passent inchangées (la résolution des grilles est bit-à-bit identique).
- Propriétés testées : pour toute suite valide de versions et toute date dans la couverture, exactement une version s'applique ; `cloreVersionPrecedente` ne crée jamais de chevauchement.
- `corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p shared-kernel referentiel-domain svc-referentiel` vert.

### Pièges connus

- `exactOptionalPropertyTypes` actif : `valideAu: string | null`, pas `?: string`.
- Ne pas « améliorer » la sémantique de borne (`valide_au` inclusif) au passage — la reprendre telle que testée dans le référentiel.

---

## Lot 2 — Grilles & barème PSU : la projection devient la source (DV-01/02)

**Modèle d'exécution : Opus 4.8.** Dépend du lot 1.

### Objectif

Côté parent : un jour de juin 2026 est chiffré avec la grille 25/26, un jour de septembre 2026 avec la grille 26/27, dans le même écran (CA1 US-30-02) — sans redéploiement de code pour changer un tarif. Côté système : plus aucune valeur tarifaire dans le domaine (`RM-30-04`).

### Périmètre exact

- `libs/contracts/referentiel/src/lib/events/referentiel-events.ts` : `GrillePubliee.v2` (payload v1 + `parametres` : montants centimes du mode projeté), nouveau `BaremePsuPublie.v1` (`{ baremeId, valideDu, valideAu, taux: Record<string, number>, plancherCentimes, plafondCentimes }`).
- `apps/svc-referentiel` : `referentiel.service.ts` — `publierGrilleAbcm` émet v2 (boucle l.139-153, en réutilisant `projeterMode` l.192-225 pour découper les montants par mode) ; nouvelle émission `BaremePsuPublie.v1` au seed PSU (`amorcerBaremes`) et méthode `publierBaremePsu` (même patron anti-chevauchement).
- `apps/svc-tarification` :
  - `consumers/projection.service.ts` : `appliquerGrillePubliee` (l.233-271) stocke les `parametres` v2 (v1 toléré : ligne sans paramètres, ignorée par le calcul) ; nouveau `appliquerBaremePsuPublie` → nouvelle table `bareme_psu` locale (migration).
  - `cout.mapper.ts` : `valoriserPrestation` reçoit la **date du mois** et un **port de résolution** (`ResolveurGrilles` : `(mode, tranche, date) → parametres | null`) ; `grillePour` (l.174-176) disparaît. `TarifCrechePsu` (l.138) reçoit le barème résolu à date au lieu du défaut en dur.
  - `cout.service.ts` : construit le résolveur depuis le read-model ; repli `ReferentielClient.grilleApplicable` (enfin injecté — `fallback.module.ts`) ; aucune version applicable ni en local ni en repli → **503** (patron `chargerFoyer` l.259-289 : jamais de valeur neutre).
- `libs/tarification/domain` : `GrilleAbcm.pour`/`GRILLE_ABCM_2026` et `BAREME_EFFORT_PSU_2026` — la **formule** reste (classes `GrilleAbcm`, `BaremeEffortPsu` construites depuis des paramètres), les **constantes** sont supprimées du chemin de calcul. Elles ne survivent que comme fixtures de specs.
- Seed referentiel (`seed.service.ts`) : inchangé sur les valeurs (il devient l'unique porteur des tarifs 2026) ; il émet désormais v2 + BaremePsu.
- Consommateurs web des constantes (`apps/web/src/utils/libelles.ts`, `apps/web/src/couts/export.ts` — relevés au grep) : à traiter selon l'usage réel (libellés ≠ montants ; si un montant en dur est affiché, le remplacer par la donnée du BFF).
- **Hors périmètre** : frais fixes ABCM (`frais-fixes-abcm.ts`, 286 €/150 €) — dette signalée mais reportée (ils ont leur logique de rattachement septembre, `cout.service.ts:166-187` ; les versionner suivra le même patron plus tard) ; l'UI de publication (lot 6).

### Décisions prises

- **Rejeu du seed** : au boot sur base déjà seedée, aucune ré-émission (idempotence l.126-129 conservée). Pour peupler les `parametres` v2 chez tarification en prod : le lot inclut une **commande de ré-émission** one-shot (`POST` interne ? non —) : décision : un script `scripts/reemettre-grilles.mjs` **n'est pas créé** ; à la place, la migration tarification back-fill `grille_tarifaire.parametres` à partir des mêmes valeurs seed est **refusée** (double source) ; le chemin retenu est : le seed referentiel détecte les grilles sans émission v2 (nouvelle colonne `version_payload` sur `grille_abcm`, défaut 1) et ré-émet **une fois** en v2 au premier boot post-déploiement. Simple, idempotent, sans intervention ops.
- La résolution locale interroge `grille_tarifaire` par `(mode, tranche, valideDu ≤ date, valideAu ≥ date | null)` via la lib du lot 1 ; index existant `(mode, tranche, valideDu)` (unique l.113) suffit.
- Le pact `api-gateway-svc-tarification.json` (1 interaction couts octobre 2026) ne change pas de forme ; l'état provider doit seeder une grille **avec paramètres** dans le read-model.

### Critères d'acceptation

- Test intégration projection : publier une grille v2 T2 `valideDu 2026-09-01` puis demander le coût de juin et de septembre → juin valorisé avec l'ancienne grille, septembre avec la nouvelle (CA1/CA2 US-30-02).
- Événement v1 rejoué (rejeu historique) → projeté sans casser, ignoré par le calcul.
- Read-model vide + referentiel joignable → le repli REST valorise ; read-model vide + referentiel injoignable → 503 (pas de montant faux).
- `grep -rn "GRILLE_ABCM_2026\|BAREME_EFFORT_PSU_2026" apps/ libs/` ne matche plus que des specs.
- Provider pacts referentiel + tarification verts ; `can-i-deploy` vert ; e2e-stack verte.
- `corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p contracts-referentiel svc-referentiel svc-tarification tarification-domain web` vert.

### Pièges connus

- `estPremiereAnneeAbcm`/frais fixes utilisent `contrat.valideDu` du read-model — ne pas y toucher ici.
- La garde de monotonie `occurred_at` (chantier confiance, lot C2) est posée sur les upserts de projection : les nouvelles écritures doivent la conserver (`setWhere` + colonnes `event_id`/`occurred_at`).
- Le mailer/exports € du web formate en `Intl` (`utils/money.ts`) — ne pas introduire de format maison.
- Ne pas supprimer la route `GET /grilles/applicable` (pact) — elle devient le repli officiel.

---

## Lot 3 — Seuils de tranche versionnés + foyer à date d'effet (DV-03, US-30-03)

**Modèle d'exécution : Opus 4.8.** Dépend des lots 1 et 2.

### Objectif

Côté parent : « j'enregistre le nouveau RFR au 1er janvier ; les mois d'avant gardent leur tranche et leurs montants » (CA1 US-30-03), et « quelle tranche s'appliquait en mars 2026 ? » est consultable (CA2).

### Périmètre exact

- **Référentiel** : table `bareme_tranches` (`valide_du`, `valide_au`, `seuils` jsonb — liste ordonnée `[{niveau, rfrMaxCentimes|null}]`, nombre de tranches libre), seed depuis les valeurs actuelles (T2 ≥ 20 k, T3 > 50 k), événement `referentiel.BaremeTranchesPublie.v1`, publication interne même patron que lot 2. Migration referentiel.
- **shared-kernel** : `Tranche.depuisRfr(rfr)` (`tranche.ts:19-27`) devient `Tranche.depuisRfr(rfr, bareme)` — les constantes `SEUIL_T2`/`SEUIL_T3` supprimées ; le type `Tranche` reste (1|2|3 minimum garanti, niveaux supplémentaires acceptés par le mécanisme).
- **svc-foyer** :
  - Devient consommateur : `ConsumerModule.forRoot({ abonnements: [{ stream: 'REFERENTIEL', durable: 'foyer-referentiel' }], tableDeadLetter, projection })` + read-model `bareme_tranches` + tables `processed_event`/`dead_letter` (migration foyer — ce sera sa **première** infra de consommation, copier la structure de svc-tarification).
  - Table `foyer_version` : `id`, `foyer_id` FK, `date_effet` NOT NULL, `ressources_mensuelles_centimes`, `rfr_centimes`, `nb_enfants_a_charge`, `nb_parts`, `saisi_le`, `motif` NULL ; unique `(foyer_id, date_effet)`. Back-fill : une version par foyer existant à `date_effet = created_at::date` (migration de données dans la même PR).
  - `PUT /foyers/:id` accepte `dateEffet` (défaut : aujourd'hui) → crée/écrase la version à cette date (même date = correction, tracée `correction_journal`) ; clôture implicite (fin dérivée, lot 1).
  - Émission `foyer.FoyerMisAJour.v3` : payload v2 + `dateEffet` + `versionId` ; la tranche transportée est dérivée avec le **barème applicable à la date d'effet**. v1/v2 ne sont plus émis (les consommateurs actuels dispatchent déjà par version).
- **svc-tarification** : read-model `foyer_version` (projection de v3 ; v1/v2 continuent d'alimenter la ligne « courante » de `foyer` pour compat) ; `chargerFoyer` (l.259-289) devient `chargerFoyerAuMois(foyerId, mois)` — résolution au 1er du mois via la lib lot 1 ; repli REST inchangé (le client foyer renvoie l'état courant : acceptable en dégradé, log warn).
- **BFF/web** : le formulaire ressources (`FoyerForm`/page `modifier`) gagne un champ « À partir du » (défaut aujourd'hui) + un lien « Historique des ressources » (liste simple : date d'effet, RFR, tranche). Route BFF `GET /foyers/:id/versions`.
- **Hors périmètre** : l'avertissement « mois communiqués » sur correction de foyer (couvert par le lot 5 pour les contrats ; pour le foyer, un simple texte « les coûts passés de ces mois seront recalculés » suffit en v1).

### Critères d'acceptation

- Saisir un RFR au 2027-01-01 qui change la tranche → coût de décembre 2026 inchangé, coût de janvier 2027 recalculé avec la nouvelle tranche (test intégration tarification bout-en-bout sur le read-model).
- `grep -rn "20000\|50000\|SEUIL_T" libs/shared-kernel apps/` ne matche plus que le seed referentiel et des specs.
- Un foyer existant (une seule version back-fillée) se comporte exactement comme avant sur tous les mois.
- Provider pact foyer vert ; e2e-stack verte ; `nx run-many -t typecheck test lint -p shared-kernel svc-referentiel svc-foyer svc-tarification api-gateway web` vert.

### Pièges connus

- L'index d'unicité e-mail parent et les guards foyer ne bougent pas — ne toucher que le volet ressources.
- `nb_parts` est en `double precision` — le porter tel quel dans la version (pas de conversion centimes).
- Le scheduler notifications lit `foyer_parent`, pas les ressources — aucun impact, ne rien « adapter » là-bas.
- La comparaison de dates ISO est lexicographique : back-fill avec `to_char(created_at,'YYYY-MM-DD')`, pas un timestamp.

---

## Lot 4 — Contrat de garde versionné : avenants + résolution temporelle

**Modèle d'exécution : Opus 4.8.** Dépend du lot 1. C'est le lot le plus lourd du chantier.

### Objectif

Côté parent : « je change la semaine type à partir du 1er septembre » sans altérer juin-août (CA1 US-30-01), date d'effet future possible (CA2), et **plus jamais** de saisies mensuelles détruites par une modification de contrat.

### Périmètre exact

- `apps/svc-planification/src/database/schema.ts` : nouvelle table `contrat_version` (`id`, `contrat_id` FK cascade, `date_effet` NOT NULL, `semaine_type` jsonb NULL, `semaine_abcm` jsonb NULL, `heures_annuelles_contractualisees`, `nb_mensualites`, `saisi_le`, `motif` NULL ; unique `(contrat_id, date_effet)`). `contrat` garde l'identité + `mode`, `enfant(_id)`, `etablissement_id`, `valide_du`/`valide_au` (bornes de vie du contrat), `premiere_inscription` ; ses colonnes versionnées deviennent **la projection de la version courante** (conservées et maintenues à chaque écriture de version → zéro migration des lecteurs existants : read-models notifications/tarification, listes web). Migration `000N` + back-fill : une `contrat_version` par contrat à `date_effet = valide_du`.
- `planification.service.ts` :
  - `creerContrat` (l.109-181) : crée contrat + version initiale (même transaction, même événement).
  - **Nouveau** `creerAvenant(contratId, dto)` : valide via le domaine, insère la version à `dateEffet` (clôture implicite), **ne touche pas** `planning_mois`, met à jour les colonnes-projection de `contrat` si la version est courante, émet `ContratModifie.v2`.
  - **Nouveau** `corrigerVersion(contratId, versionId, dto)` + `apercuImpactVersion(...)` (liste des mois couverts par la version, lecture seule). La correction écrase la version, journalise (`correction_journal`), émet `ContratModifie.v2`.
  - `modifierContrat` (l.246-335) : **supprimé** (avec sa cascade destructive l.305). La route `PUT /contrats/:id` disparaît — le web est le seul appelant, mis à jour dans le même train ; le pact « une modification de contrat crèche » est remplacé par les interactions avenant/correction.
  - `prestationsMois` (l.794-839) : charge les versions couvrant le mois, résout selon H7 (mensuel au 1er, journalier par jour) et passe au domaine une **suite de segments** `[{du, au, contratDomaine}]`.
- `libs/planification/domain` : `genererPrestationMois` (l.141-231) accepte la forme segmentée (un segment = l'existant ; plusieurs = génération par segment + fusion des prestations du mois). `contrat-creche.ts`/`inscription-abcm.ts` inchangés dans leur logique de jour.
- Événements (`libs/contracts/planification`) : `ContratCree.v2`/`ContratModifie.v2` = payload v1 + `versionId` + `dateEffet` (+ `semaineType`/`semaineAbcm` absents comme aujourd'hui — les projections n'en ont pas besoin). Projections tarification (l.279-367) et notifications : dispatch v1/v2, champs projetés inchangés.
- BFF : `POST /api/v1/contrats/:id/versions`, `PUT /api/v1/contrats/:id/versions/:versionId`, `GET /api/v1/contrats/:id/versions`, `GET /api/v1/contrats/:id/versions/:versionId/impact` — `@FoyerScope('contrat:id')`, schémas dans `bff.dto.ts` (reprendre `creerContratSchema` sans les champs d'identité), client planification étendu.
- Pacts consumer + provider planification : interactions avenant, correction, historique ; régénération à blanc.
- **Hors périmètre** : l'UI (lot 5) ; le versionnement de `premiere_inscription` (reste un booléen d'identité ABCM) ; `ecrireSemaine`/`ecrirePlanning` (les saisies restent par mois, indépendantes des versions).

### Décisions prises

- **Une version à date d'effet passée est un avenant valide** (rattraper une réalité déjà advenue n'est pas une « correction » ; la correction ne s'applique qu'à une version **existante**). L'aperçu d'impact est requis dans les deux cas quand `dateEffet ≤ aujourd'hui`.
- La validation domaine d'un avenant réutilise `ContratCreche.creer`/`InscriptionAbcm` sur le contenu de la version (les invariants par version, pas par contrat).
- `supprimerContrat` (l.509-526) : inchangé (cascade versions par FK).
- Les gestes chirurgicaux `rattacherEtablissement`/`rattacherEnfant` (l.351-503) : inchangés (identité, pas version).

### Critères d'acceptation

- Avenant au 2026-09-01 sur un contrat crèche : `GET /prestations?mois=2026-08` inchangé au centime, `2026-09` reflète la nouvelle semaine type ; **les `planning_mois` saisis existent toujours** (test intégration qui échouerait sur l'ancien code).
- Avenant à cheval : `dateEffet = 2026-09-15`, semaine type réduite → les jours 1-14 génèrent selon l'ancienne version, 15-30 selon la nouvelle ; la mensualité est celle de la version du 1er (H7, testé explicitement).
- Deux versions même date → 409 ; `dateEffet < valide_du` du contrat → 400.
- Correction d'une version passée : l'aperçu liste les bons mois ; `correction_journal` porte avant/après.
- Pactes régénérés sans doublon, provider vert en enforce, `can-i-deploy` vert ; e2e-stack verte (les specs planning existantes ne connaissent pas les avenants : elles doivent passer **sans modification** — preuve de non-régression).
- `corepack pnpm@10.34.2 nx run-many -t typecheck test lint -p planification-domain svc-planification api-gateway svc-tarification svc-notifications web` vert.

### Pièges connus

- **Le piège du lot** : les colonnes-projection de `contrat` doivent être réécrites à chaque création/correction de version **dont la période couvre aujourd'hui** — sinon les read-models et l'UI listent des paramètres périmés. Centraliser dans un helper `rafraichirProjectionContrat(tx, contratId)` appelé partout.
- Le provider pact exige les 7 jours dans `semaineType` crèche — reprendre les fixtures existantes.
- `ETAT_CONTRAT_EXISTE` et les stateHandlers (`planification.provider.pact.spec.ts:219-319`) doivent désormais seeder `contrat_version` aussi.
- La spec `planning-mbt.stack.e2e.spec.ts` génère des séquences d'écritures — vérifier qu'elle ne passait pas par `PUT /contrats/:id`.

---

## Lot 5 — UI avenants, historique, correction (US-30-01/04/05/06)

**Modèle d'exécution : Opus 4.8.** Dépend du lot 4.

### Objectif

Le parent crée un avenant en langage clair, consulte l'historique d'un contrat, corrige une version en voyant l'impact (mois recalculés, mois déjà « communiqués » signalés), et comprend un coût passé (quelles versions ont servi).

### Périmètre exact

- `apps/web/src/foyer/ContratsPage.tsx` + `ContratForm.tsx` : le bouton « Modifier » d'un contrat ouvre désormais un choix : **« Changer à partir d'une date »** (avenant — formulaire = champs versionnés + date d'effet, défaut aujourd'hui) / **« Corriger les paramètres actuels »** (correction — aperçu d'impact avant enregistrement) / lien « Historique ».
- Nouveau `apps/web/src/foyer/HistoriqueContrat.tsx` (liste : « Du 1 sept. 2026 — semaine type L/M/J/V 9h-17h — saisi le … ») + `ModaleCorrection.tsx` (aperçu : « 3 mois seront recalculés : juin, juillet, août. ⚠ Le récapitulatif de juillet a déjà été envoyé à la crèche. » + motif optionnel).
- « Mois communiqués » (CA3 US-30-05) : le BFF croise l'aperçu d'impact (mois) avec le suivi des envois de svc-notifications (route de lecture des `envoi_etablissement` par semaine, livrée par le chantier confiance — l'étendre d'une variante par plage `?du=&au=` en lecture seule si nécessaire).
- US-30-04 : le détail du coût d'un mois (`PanneauCoutMois`) affiche une ligne discrète « Calculé avec : grille du 01/01/2026 · contrat du 01/09/2025 » — le BFF couts renvoie les `valideDu` des versions résolues (champ additif de la réponse tarification, peuplé au lot 2/4).
- US-30-06 : la simulation d'avenant réutilise le mode `simule` existant (le formulaire d'avenant a un bouton « Simuler l'impact sur les coûts » → deep-link `couts?simule=1` ; quitter sans enregistrer ne crée rien — c'est déjà le comportement, à tester).
- Tests unitaires + un nouveau spec e2e `avenant-contrat.stack.e2e.spec.ts` (helpers `apps/web/e2e/support/stack.ts`).
- **Hors périmètre** : l'historique du foyer (fait au lot 3), la publication de grille (lot 6).

### Critères d'acceptation

- Parcours stack local : créer un avenant au mois prochain → planning et coûts du mois courant inchangés, l'historique montre 2 versions ; corriger la version courante → l'aperçu liste les mois, l'avertissement « déjà envoyé » apparaît si un récap existe.
- À 375 px : formulaires utilisables au pouce, modales = bottom-sheet (patron `ui/Modale.tsx`).
- Libellés sans jargon (pas de « version », « avenant » seulement en sous-titre explicatif).
- `nx run-many -t typecheck test lint -p web api-gateway` vert ; e2e stack verte.

### Pièges connus

- `useAsync` a un cache par clé : après un avenant, `reload()` explicite des contrats (`useContrats` expose `recharger`).
- Le formulaire contrat actuel mélange identité et paramètres — ne pas laisser l'avenant modifier enfant/mode/établissement (H6) : champs absents, pas juste désactivés.
- Mock des tests : ré-exporter `ApiError` dans le `vi.mock` du client (piège documenté).

---

## Lot 6 — UI publication de grille (US-30-02)

**Modèle d'exécution : Opus 4.8.** Dépend du lot 2.

### Objectif

Le parent saisit la grille d'une nouvelle année (depuis le PDF de l'établissement) avec sa période de validité — aujourd'hui c'est impossible sans redéploiement (le `POST /grilles/abcm` sans auth a été supprimé au chantier fondations, à raison).

### Périmètre exact

- svc-referentiel : routes **sécurisées** `POST /api/grilles/abcm`, `POST /api/baremes/psu`, `POST /api/baremes/tranches` (réintroduites proprement : assertion inter-services obligatoire, pas de scoping foyer — le référentiel est global) appelant les méthodes de publication existantes/du lot 2-3.
- BFF : `POST /api/v1/referentiel/grilles` etc. — **`@AdminSeulement`** ? Non : mono-foyer, le parent est souverain → `@FoyerScope` n'a pas de sens ici ; décision : routes accessibles à tout parent authentifié (pas de décorateur foyer), tracées.
- Web : nouvel écran « Tarifs » sous le panneau « Plus » (`.nav-plus-panneau`, `App.tsx:340`) : liste des grilles par période (« Grille du 01/09/2026 — en préparation / active / passée »), formulaire de saisie (une tranche = une ligne, montants en €), période de validité. Anti-chevauchement : le 409 du service remonte en message clair.
- Pact consumer/provider referentiel : nouvelles interactions de publication (attention : le pact referentiel n'a qu'une interaction aujourd'hui — toute régénération doit la préserver).
- **Hors périmètre** : import de PDF ; édition d'une grille passée (= correction rétroactive, différée — v1 : seule une grille non commencée est modifiable, sinon message renvoyant à la suppression/re-création).

### Critères d'acceptation

- Saisir la grille 26/27 au 2026-09-01 → l'écran coûts annuels chiffre juin avec 25/26 et septembre avec 26/27 (CA1 US-30-02) sans redéploiement ; aucun montant passé modifié (CA2).
- Publier une période chevauchante → erreur lisible, rien d'écrit.
- `nx run-many -t typecheck test lint -p svc-referentiel api-gateway web` vert ; pactes verts.

### Pièges connus

- Le seed reste idempotent : il ne doit jamais écraser une grille saisie par le parent (il n'amorce que si table vide — conserver).
- Montants saisis en euros à l'écran, stockés en **centimes entiers** (`Money`) — arrondir explicitement à la saisie, jamais au calcul.

---

## Lot 7 — Consolidation des modes (DV-04 réduit, H4)

**Modèle d'exécution : délégable à Sonnet 5** (mécanique, tout est listé). Aucune dépendance.

### Périmètre exact — une seule source de vérité

1. `libs/contracts/planification/src/lib/events/planification-events.ts:17-22` (`MODES_CONTRAT`) devient LA définition — la déplacer dans `libs/contracts/kernel` (`modes.ts` : `MODES_CONTRAT`, `MODES_ABCM`, `estModeAbcm`, types dérivés) et ré-exporter depuis les deux libs contracts pour compat.
2. Supprimer les redéfinitions : `libs/referentiel/domain/src/lib/mode-garde.ts:4,14` (importe du kernel), `libs/contracts/referentiel/src/lib/events/referentiel-events.ts:15` (`MODES_ABCM_CONTRAT`), `apps/svc-tarification/src/tarification/cout.service.ts:73` (`MODES_ABCM` local).
3. `libs/tarification/domain/src/lib/core/politique-tarifaire.ts:4-10` : les 2 membres supplémentaires (`FRAIS_FIXES_ABCM`, `UNITES_ASSOCIATIVES`) sont des **politiques**, pas des modes — renommer le type local (`PolitiqueTarifaire`) pour qu'il ne s'appelle plus comme un mode, composé de `ModeContrat | politiques internes`.
4. Grep final : `grep -rn "'CRECHE_PSU'\s*,\s*'\|MODES_ABCM\|ModeGarde" libs/ apps/` — plus aucune liste littérale hors kernel et specs.

### Critères d'acceptation

- Zéro changement de comportement (types identiques à l'export près) ; `nx run-many -t typecheck test lint` vert sur tous les projets touchés ; aucun pact modifié.

### Pièges connus

- L'arête `^build` de la cible `test` reconstruit `contracts-kernel` : un export ajouté est pris en compte sans geste manuel.
- Ne pas toucher aux **valeurs** ni à l'ordre des unions (les types OpenAPI générés du web y sont sensibles).

---

## Récapitulatif des actions ops (PO — hors code)

1. Aucun nouveau secret, aucune nouvelle variable compose dans ce chantier.
2. Après le train contenant le lot 2 : vérifier dans les logs svc-referentiel la ré-émission one-shot v2 (« grilles ré-émises : 3 ») et chez tarification que `grille_tarifaire.parametres` est peuplé (`SELECT count(*) FROM grille_tarifaire WHERE parametres IS NOT NULL`).
3. Après le lot 4 : smoke PO — créer un avenant réel (changement de rentrée) et vérifier les coûts d'août vs septembre.
4. La suppression de `PUT /contrats/:id` (lot 4) est un breaking interne gateway↔svc : déployer gateway et svc-planification **dans le même train** (c'est le fonctionnement normal du release train — juste ne pas cherry-picker).
