# Plan d'exécution — SFD 31 « Calendriers d'ouverture & vacances scolaires »

> **Statut** : **VALIDÉ PO le 2026-08-16** (SFD `docs/31-sfd-calendriers-vacances-scolaires.md` passée en **v1.0**, décision en son §0). Couvre US-31-01→04 et RM-31-01→05 ; **US-31-05 reportée** au plan 33 (voir l'encart avant le récapitulatif ops). **Amendement PO n°1 : le calendrier EST versionné à date d'effet** — l'ancienne décision D6 (réinterprétation de RM-31-03) est **renversée**, le plan passe de 4 à **5 lots**. L'écart de reprise du lot 4 (fermetures crèche non fériées) est **validé en écart documenté**. ⚠️ **Ne pas démarrer** : la séquence PO place ce chantier après « Le coût ne ment plus » et la migration FullCalendar 7.
> **Dépendances plan 30 : toutes LIVRÉES, en prod `0.14.0` (2026-07-29)** —
>
> - lot 1 (socle temporel) : `libs/shared-kernel/src/lib/versionnement.ts` (`@creche-planner/shared-kernel`, PR #238) — `PeriodeValidite`, comparaison ISO lexicographique, adaptateurs `depuisBornes`/`depuisSuite` ; réutilisable directement (tags `type:domain` + `context:shared`).
> - lot 7 (catalogue de modes) : `libs/contracts/kernel/src/lib/modes.ts` (PR #239) — `MODES_CONTRAT`/`ModeContrat`/`MODES_ABCM`/`estModeAbcm`. **Réserve** : inimportable depuis une lib `type:domain` (frontière Nx) — voir H6.
> - lot 4 (contrat versionné, non déclaré par la v1 de ce plan mais impactant) : génération **segmentée** `genererPrestationMoisSegments` (PR #248) — le lot 4 de ce plan se branche sur ce chemin.
>
> Le plan `planning-famille.md` (SFD 33, non exécuté) consommera le calendrier (CF-02/CF-03) ; le plan `travail-conges-revenus.md` (SFD 32) consommera `joursFeries` (H5).
> **Préalables de séquencement (inter-chantiers)** :
>
> 1. **Lot R1 du plan `consolidation-ui-et-qualite.md`** (train de release n°16 : active #257/#264/A2/A6/A7 en prod + rejeu de la projection `grille_tarifaire`) — obligatoire AVANT l'action ops n°2 de ce plan (comparaison de coûts). Voir Récapitulatif ops, point 0.
> 2. **Lot C0 de consolidation** (atterrir le chantier de navigation mobile NON COMMITÉ : `App.tsx`, `App.test.tsx`, `styles.css`, `BarreStatutCalendrier.tsx` en cours dans la copie de travail) — obligatoire AVANT les lots 3 et 5 (collision directe sur les mêmes fichiers).
> 3. **Lot C5 de consolidation** (factorisation `CalendrierCreche.tsx`/`CalendrierAbcm.tsx`, ~2 300 l.) — AVANT le lot 5, ou renoncement explicite à C5 jusqu'après ce plan (sinon double refonte des mêmes fichiers).
> 4. Les surfaces partagées (`gateway.openapi.ts`, oracle de routes, pacts, `TYPES_NOTIFICATION`) interdisent de paralléliser ce chantier avec un autre — exécution **séquentielle** entre chantiers. Ordre recommandé : consolidation → **ce plan** → SFD 32 → SFD 33 → factures réelles.
>    **Repères de lignes** : relevés le **2026-07-29 sur main `9aee291`** (copie de travail incluse pour `App.tsx` — chantier nav mobile non commité). Si un numéro a dérivé, chercher le symbole.
>    Ce plan est auto-portant.

## 1. Contexte et objectif

Rien ne matérialise aujourd'hui « du 18 avril au 4 mai c'est les vacances, l'école est fermée, l'ALSH prend le relais » :

- La seule discrimination de jours est la liste plate `jour_non_facturable` du Référentiel : 18 dates `FERMETURE_CRECHE` seedées en dur (constante `FERMETURES_2026`, `apps/svc-referentiel/src/referentiel/seed.service.ts:82-101`, insérées par `amorcerFermetures` l.195-210), consommée par la génération de prestations (`prestationsMois`, `planification.service.ts:1296-1337`, appel Référentiel l.1322 — client qui **dégrade en `[]` si injoignable**, sous-facturation silencieuse possible, `referentiel.client.ts:42-48`). **Précision qui pèse sur le lot 4** : cette liste globale est injectée dans les **quatre** modes (`generation-prestations.ts:193,215,223,235`) — les fermetures crèche excluent donc aujourd'hui aussi des jours des contrats cantine/périscolaire/ALSH de l'école.
- `JOURS_OUVERTURE_ECOLE` (`libs/planification/domain/src/lib/jour-semaine.ts:28-33`, lun/mar/jeu/ven) est une constante **morte** : seuls sa propre fonction (`estJourOuvertureEcole` l.65-67) et son spec l'utilisent.
- Côté web, la **seule** contrainte de sélectionnabilité d'un jour est la période du contrat (`useCalendrierContrat.ts` `estDansPeriode` l.181-186) : aucun férié, aucune vacance, aucune fermeture ne bloque ni ne s'affiche.

Après ce chantier : chaque établissement porte un **calendrier d'ouverture** à 3 couches (exceptions > périodes > récurrence hebdomadaire par régime), importé de l'open data Éducation nationale (zone paramétrable, zone B pour le cas réel) avec retouches manuelles préservées ; la planification, la tarification (via jours non facturables), le web s'y branchent. L'alerte « vacances sans solution » (US-31-05) est **reportée au plan 33** (voir encart).

## 2. Hypothèses assumées (réponses aux questions ouvertes — à corriger par le PO si faux)

- **H1** (Q-31-01) : l'école de référence suit la zone B en v1 ; l'import + retouches couvre l'écart si son calendrier propre diverge (c'est le design même de la SFD).
- **H2** (Q-31-02) : import **sur action manuelle uniquement** en v1 (pas de tâche de fond qui interroge l'open data ; l'app rappelle l'import via l'écran, pas via un cron).
- **H3** (Q-31-03) : pas de « modèle de fermeture annuelle réutilisable » en v1 — les fermetures crèche se saisissent comme périodes/exceptions chaque année (copie d'une année sur l'autre = amélioration future).
- **H4 — propriétaire du calendrier = svc-planification.** L'établissement (entité libre par foyer) y vit, et le **consommateur critique** (génération des prestations) y vit aussi : posséder le calendrier localement supprime l'appel inter-services dégradable en `[]`. Le Référentiel garde `jour_non_facturable` en **legacy déprécié**. ⚠️ Contrairement à ce qu'affirmait la v1 de ce plan, **sa route n'est PAS sous pact** (vérifié : les 5 pacts de `pacts/` sont tous api-gateway↔services et aucun ne couvre `GET /api/calendrier/jours-non-facturables` ; la gateway ne relaie pas cette route ; son seul consommateur est le fetch de svc-planification, sans pact inter-services). La garder reste défendable — c'est le **filet de rollback du lot 4** — mais sous forme de **dépréciation datée avec échéance de suppression**, pas de rétrocompat éternelle.
- **H5 — jours fériés calculés, pas importés** : les fériés français sont dérivables par algorithme (fixes + mobiles basés sur Pâques). Le cas réel est **Mulhouse → régime Alsace-Moselle** (Vendredi saint + 26 décembre en plus) : le régime de fériés est un **paramètre par établissement** (`FR` | `FR_ALSACE_MOSELLE`), pas une constante (RM-31-05). **Décision inter-plans (placement)** : `joursFeries(annee, regime)` vit dans **`libs/shared-kernel`** (à côté de `versionnement.ts`, tags `type:domain` + `context:shared` → importable de tous les contextes), **pas** dans `libs/planification/domain` : le plan 32 (H3/lot 3, décompte des congés) le réutilise depuis le futur `famille-domain`, et les `depConstraints` (`eslint.config.mjs:24-101`) interdisent tout import inter-contextes hors `context:shared`. Le type de régime est **ouvert/extensible** (`FR`, `FR_ALSACE_MOSELLE` ; `CH_BL` sera ajouté par le plan 32).
- **H6** : granularité de « service » = les modes du catalogue consolidé **livré** (`libs/contracts/kernel/src/lib/modes.ts` : `CRECHE_PSU`, `CANTINE`, `PERISCOLAIRE`, `ALSH`) + la distinction ALSH journée/½ journée portée par la saisie existante (`JourAlshHebdo`, `inscription-abcm.ts`), pas par le calendrier. ⚠️ **Frontière Nx** : les libs `type:domain` ne peuvent pas importer `type:contracts` — `calendrier-ouverture.ts` porte donc une **union locale de modes** (miroir documenté, patron `referentiel-domain` posé par #239 et rappelé en tête de `modes.ts`), tenue identique à `MODES_CONTRAT` par convention.
- **H7** : aucune nouvelle dépendance npm (l'appel open data se fait en `fetch` natif, patron des clients existants).

## 3. Décisions structurantes

- **D1 — modèle 3 couches en domaine pur** (`libs/planification/domain`, nouveau module `calendrier-ouverture.ts`) : `resoudreJour(calendrier, iso) → { contexte: PERIODE_SCOLAIRE|VACANCES|FERIE|FERMETURE, libelle, servicesOuverts }`. `servicesOuverts` est typé sur l'**union locale** de modes (H6). Priorité RM-31-01 : exception > férié > période > récurrence. Fonction pure, testable exhaustivement ; les fériés viennent de `joursFeries` (shared-kernel, H5).
- **D2 — tables (svc-planification)** :
  - `calendrier_periode` : `id`, `etablissement_id` FK, `type` (`PERIODE_SCOLAIRE`|`VACANCES`|`FERMETURE_ANNUELLE`), `libelle`, `du`, `au`, `source` (`IMPORT`|`MANUEL`), `annee_scolaire` (`2026-2027`), `importe_le` NULL.
  - `calendrier_exception` : `id`, `etablissement_id` FK, `jour`, `type` (`FERMETURE`|`OUVERTURE`|`JOURNEE_PEDAGOGIQUE`|`PONT`), `libelle`, `services` jsonb NULL (null = tous). Unique `(etablissement_id, jour)`.
  - `calendrier_recurrence` : `id`, `etablissement_id` FK, `regime` (`SCOLAIRE`|`VACANCES`), `jour_semaine`, `services` jsonb. Unique `(etablissement_id, regime, jour_semaine)`.
  - `etablissement` : colonnes additives `zone_scolaire` varchar NULL (`A`|`B`|`C`|null = pas de calendrier scolaire) et `regime_feries` varchar NOT NULL default `FR` (le défaut national) ; le seed du foyer de référence pose `FR_ALSACE_MOSELLE`. NB : la table porte déjà `types` jsonb `ModeContrat[]` **informatif**, default `'[]'` (`apps/svc-planification/src/database/schema.ts:236-239`) — ne pas s'en servir comme sélecteur fiable (cf. reprise du lot 4).
  - Les jsonb `services` sont **validés par zod à l'écriture** contre les modes connus — sinon des modes inconnus dorment en base et cassent la résolution plus tard.
  - ⚠️ **Révisé le 2026-08-16 — les deux contraintes `UNIQUE` ci-dessus deviennent fausses telles qu'écrites.** L'historisation exigée par la D6 révisée conserve la ligne antérieure : `(etablissement_id, jour)` sur les exceptions et `(etablissement_id, regime, jour_semaine)` sur les récurrences interdiraient précisément ce qu'on veut garder. Elles doivent devenir des unicités **partielles** — uniques parmi les lignes encore ouvertes, pas parmi toutes. C'est le genre de détail qui ne se voit qu'à la deuxième retouche, en production : la forme exacte se pose au lot 1 avec le domaine, et le lot 2 la traduit. Le reste des colonnes de la D2 est inchangé.
- **D3 — import open data** : `GET https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records` filtré par `zones` + `annee_scolaire`, appelé par svc-planification sur `POST` déclenché par le parent (US-31-01), **matérialisé** en `calendrier_periode source=IMPORT`. Réimport : remplace les périodes `IMPORT` de l'année **dans une transaction** (delete+insert atomique), ne touche jamais `MANUEL` ni les exceptions (CA2). Mapping des bornes : voir lot 2 (datetimes UTC → date locale, sémantique « fin des cours »). Échec réseau → erreur propre, saisie manuelle toujours possible (CA3).
- **D4 — RM-31-04, source unique des jours non facturables** : `prestationsMois` n'appelle plus le Référentiel ; les jours exclus deviennent « jours où le service du contrat n'est pas ouvert » selon le calendrier de **l'établissement du contrat**. Reprise de données : les 18 `FERMETURE_CRECHE` seedées deviennent des `calendrier_exception` de l'établissement crèche (seed + reprise prod, modalités précises au lot 4). La route Référentiel et sa table restent en **dépréciation datée** (filet de rollback — H4), plus aucun appelant runtime. ⚠️ **Changement de périmètre assumé** : la liste globale s'applique aujourd'hui aux 4 modes ; la reprise ne recrée des exceptions **que sur la crèche** → les fermetures crèche **non fériées** cesseront d'exclure des jours cantine/péri/ALSH (écarts énumérés et validés au lot 4 — le critère « même résultat au centime » de la v1 de ce plan était intenable tel quel).
- **D5 — la récurrence remplace `JOURS_OUVERTURE_ECOLE`** : le seed du foyer de référence pose la récurrence école (`SCOLAIRE` : école/cantine/périscolaire lun-mar-jeu-ven, ALSH mercredi ; `VACANCES` : ALSH seul) ; la constante morte est supprimée (lot 4).
- ~~**D6 — RM-31-03** : le calendrier n'est **pas** versionné à date d'effet en v1 au sens du plan 30 (les périodes/exceptions sont déjà datées par nature) ; la protection du passé facturé passe par l'avertissement d'incohérences (CA4 US-31-03), pas par des versions de calendrier. C'est une **réinterprétation** de RM-31-03 — à faire valider **explicitement** par le PO.~~ (énoncé d'origine — **RENVERSÉ par le PO le 2026-08-16**)
- **D6 (révisée 2026-08-16) — le calendrier est versionné, et le passé facturé est intouchable.** Le PO a tranché la contradiction en faveur du texte de la SFD : RM-31-03 tient. Ce que cela impose, et qui n'est pas négociable par une session d'exécution :
  - **Deux axes de temps, pas un.** Les périodes et exceptions portent déjà un temps **métier** (`du`/`au` : quand la période a lieu). Ce qui manque est le temps de **connaissance** : ce que le calendrier disait **au moment où un mois a été facturé**. La résolution devient `resoudreJour(calendrier, jour, aLaDate)` — deux paramètres temporels de nature différente, jamais interchangeables.
  - ⚠️ **`libs/shared-kernel/src/lib/versionnement.ts` ne fournit PAS cet axe, et le croire serait le piège du chantier.** `PeriodeValidite`, `selectionnerVersionApplicable` et `depuisSuite` versionnent le temps **métier** (une ressource vaut telle valeur à partir de telle date d'effet) — exactement l'axe que le calendrier possède déjà. Réutiliser ces helpers pour porter la connaissance confondrait les deux axes, et le symptôme n'apparaîtrait qu'à la première retouche d'une période passée. Le socle est réutilisable pour les **bornes de période**, jamais pour l'historisation des retouches.
  - **Le modèle retenu est l'historisation par ligne** (append-only sur les trois tables : une retouche n'écrase ni ne supprime, elle clôt la ligne précédente et en ouvre une nouvelle), et **non** un cliché complet du calendrier par version — un cliché recopierait les trois couches à chaque retouche pour un gain de lisibilité qui ne compense pas le volume ni la reprise. Les colonnes exactes se posent au lot 1 avec le domaine, pas au lot 2 : c'est le domaine qui dit ce que la persistance doit savoir.
  - **Question à trancher au lot 1, avec deux candidats et aucune réponse évidente — l'ancre de connaissance.** Pour régénérer un mois déjà facturé, il faut un instant : (a) l'instant de **première facturation** du mois, ce qui suppose que la facturation l'enregistre — plus juste, mais ajoute une colonne au chemin de génération ; (b) l'instant de création des prestations du mois (`cree_le` existant) — gratuit, mais faux dès qu'un mois est régénéré pour une autre raison. **Trancher explicitement et écrire le motif** ; ne pas laisser le choix se faire par le premier `SELECT` écrit.
  - **Conséquence sur CA4, et c'est une simplification** : la liste d'incohérences ne porte plus que sur les jours **non encore facturés**. Le passé n'a plus besoin d'être rattrapé par un avertissement, il est protégé structurellement. L'avertissement reste utile pour le futur réservé — il n'est simplement plus le seul filet.
  - **Conséquence sur le contrat de lecture** (figé dès le lot 2, consommé **sans pact** par le plan 33) : le paramètre `aLaDate` et sa sémantique entrent dans le contrat **dès sa première publication**. L'ajouter après coup casserait un consommateur silencieux — c'est le seul point du chantier où une erreur ne se voit qu'à retardement.
- **D7 — établissement vierge = ouvert tous les jours SAUF les fériés de son régime.** La v1 de ce plan portait une contradiction interne : « vierge → tous services ouverts tous les jours » vs « férié = fermeture par défaut » (RM-31-02). On tranche en faveur des fériés : `regime_feries` est NOT NULL default `FR`, donc calculable même sans aucune donnée calendrier. Sans cela, dès le déploiement du lot 4 et tant que le PO n'a pas configuré le calendrier de l'école en prod, les fériés tombant un jour d'école (01/05, 08/05, Ascension…) redeviendraient facturables pour cantine/péri — régression réelle vs la liste globale actuelle. La non-régression des jours de fermeture **non fériés** reste, elle, portée par la reprise du lot 4.

## 4. Conventions transversales

Identiques au plan `versionnement-dates-effet.md` §4 (corepack pnpm, typecheck+test, pactes à blanc, migrations au boot, ratchet, e2e destructif, langage parent). S'y référer. S'y ajoutent :

- **Checklist contrat BFF** — pour CHAQUE lot exposant une nouvelle route relayée par la gateway (lots 2, 3, 5 depuis le redécoupage du 2026-08-16) : entrée dans `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` (document **manuel**) ; faire évoluer l'oracle « expose exactement les N routes attendues » (`gateway.openapi.spec.ts`, **38 routes depuis le lot C7**, 37 après D6, 27 avant) ; `pnpm nx run web:generate-types` sans diff (`types/bff.ts` est **GÉNÉRÉ** — job CI `openapi-types-drift`) ; pact consumer + provider pour la route (y compris le `POST` import du lot 2). ⚠️ Depuis D6, une route servie mais absente du document fait **échouer `nx test api-gateway`** (`openapi.couverture.spec.ts` compare le document au graphe de modules Nest) : l'oubli n'est plus silencieux.
- **Gate CI de couverture** : échec si −0,5 pt de lignes vs main — tout service/écran massif neuf (import, écran calendrier) arrive avec ses specs **dans la même PR**.
- **Sécurité inter-services** : la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` arrivera pendant ces chantiers — toute nouvelle route svc-planification porte son `@ScopeFoyerInterServices` dès le premier commit (jamais d'observe-only qui casserait à la bascule).

## 5. Vue d'ensemble des lots

**Découpage révisé le 2026-08-16** (amendement PO n°1, D6 révisée). L'ancien lot 1 portait domaine + schéma + API en un seul bloc ; le versionnement ajoute un axe de temps qui se décide **dans le domaine** et se paie **dans le schéma et le contrat**. Le lot 1 est donc scindé sur cette couture, ce qui matérialise le « +1 lot » assumé par le PO. Poser le versionnement plus tard aurait coûté une seconde migration **et** une rupture du contrat de lecture déjà publié.

| #     | Lot                                                                        | Dépend de                                                       | Modèle   |
| ----- | -------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| 1     | Domaine calendrier **versionné** + fériés partagés (pur, sans base ni API) | — (socle plan 30 livré)                                         | Opus 4.8 |
| 2     | Schéma versionné + API de lecture résolue (contrat figé ici)               | 1                                                               | Opus 4.8 |
| 3     | Import open data + écran calendrier (import, retouches, périodes)          | 2 + **C0 (consolidation) mergé**                                | Opus 4.8 |
| 4     | Branchement génération de prestations + reprise `jour_non_facturable`      | 2                                                               | Opus 4.8 |
| 5     | Web : sélectionnabilité des jours + visualisation + incohérences           | 2 (et 4 pour la cohérence bout-en-bout) + **C0, et C5 tranché** | Opus 4.8 |
| ~~—~~ | ~~Alerte « vacances sans solution »~~                                      | **RETIRÉE** — absorbée par le plan 33 lot 5 (voir encart)       | —        |

Ordre : 1 → 2 → 3 → 4 → 5. Les lots 3 et 4 sont parallélisables (fichiers disjoints hors schéma — merger 3 d'abord). **Le lot 1 ne se parallélise avec rien** : il fixe la sémantique des deux axes de temps dont les quatre autres dépendent.

---

## Lot 1 — Domaine calendrier versionné + fériés partagés

**Modèle : Opus 4.8.** Aucune base, aucune route, aucune UI : **du domaine pur**. Ce lot existe séparément depuis l'amendement PO du 2026-08-16 — c'est ici que la sémantique des deux axes de temps se décide, avant qu'une table ou un contrat ne la fige.

### Objectif

Une fonction pure sait répondre, pour un établissement, un jour J **et un instant de connaissance** : « quels services sont réservables, dans quel contexte (période scolaire, vacances de printemps, férié, fermeture) » — et rend, pour un jour déjà facturé, **la même réponse qu'au moment de la facturation**, quelles qu'aient été les retouches depuis.

### Périmètre exact

- **`libs/shared-kernel`** (nouveau module à côté de `versionnement.ts`, + specs) : `joursFeries(annee, regime)` — algorithme de Pâques (Gauss), fixes FR, + Vendredi saint/26-12 pour `FR_ALSACE_MOSELLE` ; type de régime **extensible** (le plan 32 ajoutera `CH_BL`). C'est la **décision inter-plans** de H5 : ce module doit être importable des contextes planification ET famille.
- `libs/planification/domain/src/lib/calendrier-ouverture.ts` (+ specs, + mbt — les invariants existent, cf. table de vérité) : types des 3 couches **historisés**, union locale de modes (miroir documenté, H6), `resoudreJour(calendrier, jour, aLaDate)`, `resoudreMois` (batch, même `aLaDate` pour tout le mois). Réutiliser la comparaison ISO lexicographique du dépôt.
- **La forme d'historisation est arrêtée ici** (D6 révisée) : append-only par ligne, une retouche clôt et ouvre au lieu d'écraser. Le domaine expose ce que la persistance devra savoir — le lot 2 s'y conforme, jamais l'inverse.
- **L'ancre de connaissance est tranchée ici** (les deux candidats sont en D6 révisée), avec son motif écrit dans le module. C'est la décision la plus lourde du chantier : elle détermine si un mois régénéré pour une autre raison conserve son interprétation.
- **Hors périmètre** : toute persistance et toute route (lot 2), l'import (lot 3), le branchement de la génération (lot 4), toute UI (lots 3/5).

### Décisions prises

- La résolution renvoie aussi les jours **hors** de toute période : contexte = `PERIODE_SCOLAIRE` par défaut si une récurrence `SCOLAIRE` existe, sinon « ouvert selon récurrence unique » (cas crèche : un seul régime, `SCOLAIRE` utilisé comme régime unique — pas de notion de vacances, conforme SFD §2).
- Fériés : fermeture par défaut de tous les services (RM-31-02), surchargée par une exception `OUVERTURE`. **Les fériés ne sont pas historisés** — ils sont calculés, donc déterministes et identiques quel que soit l'instant de connaissance. Un seul axe de temps s'y applique.
- Un établissement sans récurrence saisie = ouvert tous les jours **sauf les fériés de son régime** (D7 — les établissements existants ne changent de comportement, hors fériés, qu'à la saisie d'une récurrence). **C'est la clé de la non-régression**, complétée par la reprise du lot 4.

### Critères d'acceptation

- Table de vérité testée : mercredi scolaire → ALSH seul ; jeudi de vacances → ALSH seul ; Vendredi saint régime Alsace-Moselle → tout fermé ; Vendredi saint régime FR → ouvert ; exception `OUVERTURE` sur férié → ouvert ; jour de fermeture annuelle crèche → fermé avec libellé.
- Un établissement vierge (aucune donnée calendrier) → tous services ouverts tous les jours **sauf les fériés de son régime** (D7).
- **Invariant du versionnement, testé en propre** : pour un jour J et deux instants de connaissance encadrant une retouche, la résolution rend l'ancienne réponse avant et la nouvelle après — et la retouche d'une période **passée** ne change rien à la résolution antérieure. C'est le critère qui prouve l'amendement PO ; sans lui le lot ne vaut rien.
- **Sonde négative** : supprimer l'axe `aLaDate` (ou le figer à « maintenant ») doit faire **rouge** le test ci-dessus. Une résolution qui ignore l'instant de connaissance et reste verte signifie que la garde ne garde rien.
- `joursFeries` : specs exhaustifs 2026/2027 pour `FR` et `FR_ALSACE_MOSELLE` (Pâques mobile).
- `pnpm nx run-many -t typecheck test lint -p shared-kernel planification-domain` vert.

### Pièges connus

- ⚠️ **Ne pas porter la connaissance avec `versionnement.ts`** (D6 révisée) : ce socle versionne le temps **métier**, pas le temps de connaissance. Il reste le bon outil pour les bornes `du`/`au` d'une période.
- Les dates ISO se comparent lexicographiquement — pas de `Date` dans le domaine (convention `versionnement.ts`/domaine existant, tout est UTC-naïf). ⚠️ L'instant de connaissance, lui, est un **horodatage**, pas une date ISO nue : ne pas le replier sur le même type par confort, les deux axes ne se comparent jamais entre eux.
- `noUncheckedIndexedAccess` : les `Record<JourSemaine, …>` partiels demandent des accès gardés.

---

## Lot 2 — Schéma versionné + API de lecture résolue

**Modèle : Opus 4.8.** Dépend du lot 1. **Le contrat de lecture est figé par ce lot** — c'est son enjeu principal.

### Objectif

Le calendrier existe en base sous une forme historisée conforme au lot 1, et se lit par une route dont la forme est stable pour des mois.

### Périmètre exact

- `apps/svc-planification` : **migration `0009`** (dernière existante : `0008_wide_iron_monger.sql`) — tables D2 **historisées selon le lot 1** + colonnes établissement ; `calendrier.service.ts` (CRUD périodes/exceptions/récurrences en **append-only**, lecture résolue, validation zod des jsonb `services`) ; `calendrier.controller.ts` : `GET /api/etablissements/:id/calendrier?du=&au=&aLaDate=` (jours résolus), `GET/PUT /api/etablissements/:id/calendrier/recurrences`, `POST/DELETE /api/etablissements/:id/calendrier/exceptions`, `POST/PUT/DELETE …/periodes`. Scoping : patron `@ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })` **déjà en place** (`apps/svc-planification/src/etablissement/etablissement.controller.ts:53-71`, résolveur `security/resolveur-foyer.ts`, ressource `'etablissement'`).
- Seed de démo (`scripts/seed-demo.mjs`) : récurrences + zone B + régime Alsace-Moselle pour l'école, exceptions de fermeture pour la crèche. ⚠️ Le seed passe par l'**API BFF** (patron `garantirEtablissements` l.408) — le seed calendrier utilisera les nouvelles routes BFF de ce lot, pas du SQL.
- BFF : client planification étendu + `GET/… /api/v1/foyers/:foyerId/etablissements/:id/calendrier*` (`@FoyerScope('param:foyerId')`), schémas `bff.dto.ts` + **checklist contrat §4** (openapi + oracle 27→N + generate-types + pact consumer/provider, interaction « une lecture du calendrier résolu d'un établissement » + état seedant périodes/exceptions/récurrences).
- **Contrat de réponse STABLE dès ce lot** pour `GET /api/etablissements/:id/calendrier` (`{ contexte, libelle, servicesOuverts }` par jour, **plus le paramètre `aLaDate` et sa sémantique**) : le plan 33 (D1/lot 1) le consommera par client REST inter-services (patron fallback, **sans pact** — comme tarification→planification) ; tout changement de forme après coup casserait un consommateur silencieux. `aLaDate` omis = « maintenant » — le défaut doit être **explicite dans le document OpenAPI**, pas implicite dans le code.
- **Hors périmètre** : l'import (lot 3), tout branchement de la génération (lot 4), toute UI (lots 3/5).

### Critères d'acceptation

- Une retouche laisse la ligne antérieure lisible en base (rien n'est écrasé ni supprimé), vérifié par un test qui relit **après** la retouche.
- La route rend deux réponses différentes pour deux `aLaDate` encadrant une retouche, et la même pour deux instants n'en encadrant aucune.
- Pactes verts, oracle OpenAPI mis à jour, `pnpm nx run-many -t typecheck test lint -p svc-planification api-gateway` vert.

### Pièges connus

- Le résolveur foyer de svc-planification résout déjà `etablissement→foyer` (chantier fondations) — le réutiliser, pas de nouveau résolveur.
- `nx <svc>:typecheck` est lib-only (ne typecheck pas les specs) — la CI si ; reproduire avec `tsc --build tsconfig.spec.json` depuis le dossier du service.
- ⚠️ **`aLaDate` traverse quatre couches** (route → BFF → `bff.dto.ts` → `z.object` du client web) et le `z.object` **strippe les clés qu'il ne connaît pas** : un oubli à la dernière étape est **silencieux** (`LE-48`). Le vérifier explicitement, pas le supposer.

---

## Lot 3 — Import open data + écran calendrier

**Modèle : Opus 4.8.** Dépend du lot 2. **Préalable : lot C0 de consolidation mergé** (le chantier nav mobile non commité touche `App.tsx`/`styles.css`, exactement la zone de ce lot).

### Objectif

US-31-01/US-31-02 : le parent importe l'année scolaire de la zone de l'établissement, voit les périodes (Toussaint, Noël, hiver, printemps, été), et retouche (journée pédagogique, pont, fermeture ALSH, semaine de fermeture crèche). Un réimport ne détruit aucune retouche.

### Périmètre exact

- svc-planification : `calendrier-import.service.ts` — client `fetch` vers data.education.gouv.fr (D3), timeout + message d'erreur actionnable ; mapping records → `calendrier_periode` (`source=IMPORT`, `annee_scolaire`, libellés officiels « Vacances de la Toussaint »…). Route `POST /api/etablissements/:id/calendrier/import { anneeScolaire }` (scoping comme au lot 1).
- BFF : relais du POST import + **checklist contrat §4** (openapi + oracle + generate-types + **pact du POST import** — la v1 de ce plan l'omettait).
- Web : nouvel écran **« Calendrier »** accessible depuis `EtablissementsPage` (bouton par établissement) :
  - Route **enfant** de `<Route path="/foyers/:foyerId" element={<GardeFoyer />}>` (`App.tsx:631-641`, routes **imbriquées** — plus les routes plates de la v1 de ce plan) : `<Route path="etablissements/:etabId/calendrier" …>` — le guard foyer est gratuit par imbrication.
  - `titreDepuisPathname` (`App.tsx:563-583`) est devenu une **regex à liste blanche de segments** (l.569 : `^\/foyers\/[^/]+\/(dashboard|contrats|planning|couts|etablissements|modifier)$`) qui ne matchera jamais un chemin profond : **étendre la regex ou ajouter un cas dédié**, pas seulement « ajouter un titre ».
  - En-tête : zone scolaire (sélecteur A/B/C/aucune) + régime fériés + bouton « Importer l'année 2026-2027 ».
  - Liste des périodes (libellé, dates, badge « importé »/« saisi ») ; liste des exceptions avec ajout/suppression (date, type, libellé) ; récurrence hebdo par régime (cases jours × services — réutiliser le patron de saisie semaine ABCM de `apps/web/src/foyer/ContratForm.tsx`).
- Tests : unit service import (mapping, réimport préservant `MANUEL` + exceptions, échec réseau) ; unit écran ; les appels réseau open data sont **toujours mockés** en test.
- **Hors périmètre** : import automatique planifié (H2) ; toute influence sur la génération (lot 4).

### Décisions prises

- L'import est **idempotent par année et transactionnel** : `delete … where source='IMPORT' and annee_scolaire=$1` puis insert **dans une même transaction** (double-clic, imports concurrents) — les périodes `MANUEL` et les exceptions survivent par construction (CA2 mécanique, pas heuristique).
- **Mapping des bornes ODS, figé dans la fixture commitée** : les bornes des enregistrements sont des **datetimes UTC** (ex. `2026-04-17T22:00:00+00:00`) — conversion **Europe/Paris** obligatoire, sinon décalage d'un jour ; et la sémantique officielle est « `start_date` = fin des cours » (les vacances commencent le soir) → règle retenue : **début des vacances = lendemain du dernier jour de classe** (fin = jour de reprise exclu). Les deux conventions sont documentées dans le service et verrouillées par la fixture.
- La zone est modifiable après coup ; changer de zone n'importe rien tout seul (le parent réimporte).
- L'API ODS renvoie les périodes par zone avec chevauchements interzones — filtrer strictement `zones = "Zone B"` et `population != "Enseignants"` (piège connu du jeu de données : lignes « Enseignants » en double).

### Critères d'acceptation

- Import zone B 2026-2027 (mock du JSON réel de l'API) → périodes visibles avec les bons libellés/dates **locales** ; ajout d'une exception « Journée pédagogique 2027-03-13 » ; réimport → l'exception et une période saisie à la main sont intactes (CA2), les périodes importées sont rafraîchies.
- Échec de l'API (500 simulé) → message clair, l'écran reste utilisable en saisie manuelle (CA3).
- À 375 px : listes lisibles, cibles 44 px ; **la barre d'onglets basse reflète un état actif cohérent sur la route profonde** `/foyers/:id/etablissements/:etabId/calendrier` (la logique actuelle d'onglet actif repose sur une égalité stricte de pathname, en refonte dans C0 — coordonner). `pnpm nx run-many -t typecheck test lint -p svc-planification api-gateway web` vert.

### Pièges connus

- Ne **jamais** appeler l'API réelle dans les tests ni en CI (aucun secret requis, mais flakiness) ; le mock JSON est commité en fixture.
- `verbatimModuleSyntax` web : `import type` sur tous les types.
- L'e2e stack n'a pas accès à Internet garanti — le spec e2e de cet écran se limite à la saisie manuelle (l'import est couvert en unit).
- **Egress prod** : c'est la **première dépendance sortante d'un service métier vers Internet** — vérifier que le pare-feu (DOCKER-USER/ufw-docker, doc 24) et le durcissement A6 laissent sortir le HTTPS du conteneur svc-planification, et logger un diagnostic explicite si l'appel échoue (CA3 couvre l'UX, pas le diagnostic ops — cf. Récapitulatif ops n°3).

---

## Lot 4 — Branchement génération de prestations + reprise `jour_non_facturable`

**Modèle : Opus 4.8.** Dépend du lot 2. **Le lot le plus sensible : il touche la facturation.**

⚠️ **Point d'attention né de l'amendement PO du 2026-08-16** : c'est ici que le versionnement du calendrier cesse d'être une propriété du domaine pour devenir une propriété du **montant**. La génération d'un mois doit résoudre le calendrier **à l'instant de connaissance de ce mois** (ancre tranchée au lot 1), et non « maintenant ». Une génération qui appellerait la résolution sans `aLaDate` compilerait, passerait les tests de la table de vérité, et **annulerait silencieusement tout l'amendement** — le mois passé serait recalculé avec le calendrier d'aujourd'hui. Un test de non-régression explicite est exigé : retoucher une période passée, régénérer, constater que le montant **ne bouge pas**.

### Objectif

RM-31-04 : un jour non ouvert n'est jamais facturable, à partir d'une source unique (le calendrier de l'établissement du contrat). L'appel dégradable au Référentiel disparaît.

### Périmètre exact

- `apps/svc-planification/src/planification/planification.service.ts` : `prestationsMois` (l.1296-1337) — remplacer `this.referentiel.joursNonFacturables()` (l.1322) par la résolution locale : jours du mois où le **mode du contrat** n'est pas dans `servicesOuverts` de l'établissement du contrat. ⚠️ Depuis SFD 30 lot 4 (#248), la génération est **segmentée** par versions de contrat : l'entrée runtime est `genererPrestationMoisSegments(segments, mois, saisie, joursNonFacturables)` (`generation-prestations.ts:364`) — le paramètre `joursNonFacturables` survit tel quel (le point de branchement reste valide) ; on change la **provenance** de la liste, pas l'interface du domaine.
- Reprise de données (même PR) : migration de données svc-planification qui, au boot, crée les exceptions correspondant aux 18 dates de `FERMETURES_2026`. Modalités précises :
  - la constante est **DUPLIQUÉE dans la migration** (gel volontaire de données publiques) — la base du Référentiel n'est pas accessible depuis svc-planification et un appel HTTP au boot serait fragile ;
  - **scoping** : établissements liés à **≥ 1 contrat `CRECHE_PSU`** — PAS le jsonb `types` (informatif, default `'[]'`, `schema.ts:236-239`, fragile) ; les 18 dates sont des données du foyer réel — les injecter dans toutes les crèches de tous les foyers (staging/e2e multi-foyers) serait une fuite de données de référence ;
  - **idempotence** par absence d'exception préexistante sur `(etablissement_id, jour)` ;
  - **log de comptage exact** (« exceptions crèche créées depuis jour_non_facturable : N ») — c'est le libellé attendu par le récap ops n°2.
    En dev/CI, le seed-demo fait pareil.
- `referentiel.client.ts` de planification (`joursNonFacturables`) : supprimé avec son module d'appel ; la route et la table Référentiel restent en **dépréciation datée** avec échéance de suppression (commentaire daté — pas d'argument pact, il n'y en a pas : H4).
- Suppression de `JOURS_OUVERTURE_ECOLE` + `estJourOuvertureEcole` (`jour-semaine.ts:28-33,65-67`, morts).
- **Hors périmètre** : le web (lot 5) ; la route Référentiel (gardée en filet) ; la tarification (elle appelle planification via son client de repli et reçoit les prestations déjà filtrées — aucun changement).

### Décisions prises

- **Différentiel à écarts attendus** (remplace le « exactement le même résultat au centime » de la v1, intenable) : la liste globale s'applique aujourd'hui aux 4 modes (`generation-prestations.ts:193,215,223,235`) mais la reprise ne crée d'exceptions **que sur la crèche**. Énumérer les écarts par mode × date :
  - **fériés** (01/01, 06/04, 01/05, 08/05, 14/05, 25/05, 14/07/2026) → **identiques** avant/après (recalculés par `joursFeries` + D7, tous régimes) ;
  - **fermetures crèche non fériées** (02–04/01, 15–17/05, 27–31/07/2026) → **cessent d'exclure** cantine/péri/ALSH (c'était un effet de bord de la liste globale, pas une règle métier de l'école). Écarts **à faire valider par le PO** — ou décision explicite de les reproduire côté école via des exceptions (non recommandé : l'école n'est pas fermée quand la crèche l'est).
    Capturer l'avant **depuis main ET depuis un dump prod** des prestations 2026 ; le test différentiel encode la liste exhaustive des écarts attendus, tout écart hors liste = échec.
- **Rollback** (à documenter dans la PR) : viable par design — la route et la table Référentiel survivent, les images précédentes refonctionnent telles quelles. Pendant la reprise, **interdiction de toucher aux données Référentiel** (elles restent le filet).
- Établissement fermé ≠ absence enfant : la sémantique actuelle (jour non facturable = pas d'heures réservées, `contrat-creche.ts:207-219` ; jours ABCM filtrés, `inscription-abcm.ts:202-207`) est conservée telle quelle.
- L'ordre de merge interne du lot garantit qu'aucun état intermédiaire ne facture les jours de fermeture (résolution + reprise dans le même train).

### Critères d'acceptation

- Test différentiel à écarts attendus : sur le seed de démo, `GET /prestations` de chaque contrat × chaque mois de 2026 donne le résultat d'avant **modulo la liste d'écarts énumérée** ci-dessus (aucun écart hors liste). C'est le critère n°1.
- Nouveau comportement : une exception `FERMETURE` ajoutée sur un jour de garde → le jour disparaît des prestations du mois ; une période `VACANCES` → les jours cantine/péri de la période disparaissent, les ALSH explicites restent.
- Panne simulée : plus aucun chemin ne dépend du Référentiel pour générer (le risque « dégrade en [] » documenté disparaît).
- Provider pact planification vert ; e2e-stack verte ; `pnpm nx run-many -t typecheck test lint -p planification-domain svc-planification` vert.

### Pièges connus

- **ALSH pendant les vacances** : l'ALSH est précisément le service ouvert quand l'école ferme — le filtre est **par service**, pas par jour entier. Un « mercredi de vacances » ferme cantine/péri mais pas l'ALSH (c'est le bug le plus facile à écrire).
- La génération est appelée aussi par `svc-tarification` via REST et par les notifications (récap) — le test différentiel couvre la chaîne.
- `e2e-stack` : l'orchestrateur reseede — vérifier que le seed calendrier est dans `seed-demo.mjs` avant de lancer.
- La comparaison de coûts prod (récap ops n°2) exige le **préalable #257** (récap ops n°0) — sinon repli REST + `dead_letter` parasitent la lecture.

---

## Lot 5 — Web : sélectionnabilité, visualisation, incohérences

**Modèle : Opus 4.8.** Dépend du lot 2 (et du 4 pour la cohérence bout-en-bout). **Préalables : lot C0 de consolidation mergé** (nav mobile non commitée dans `App.tsx`/`styles.css`) **et sort de C5 tranché** (factorisation `CalendrierCreche.tsx`/`CalendrierAbcm.tsx` AVANT ce lot, ou explicitement reportée après — jamais en parallèle).

### Objectif

US-31-03/US-31-04 : quand le parent planifie, seuls les jours/services réellement ouverts sont sélectionnables (motif affiché sinon) ; les vues mensuelles distinguent période scolaire / vacances / jour fermé ; les jours réservés devenus fermés après retouche remontent en liste d'incohérences, jamais supprimés en silence (CA4).

### Périmètre exact

- `apps/web/src/api/client.ts` (patron `requeteIdempotente`, l.187) : `lireCalendrierEtablissement(etabId, du, au)` (GET, clé de cache `calendrier:${etabId}:${du}`). Les types viennent de `types/bff.ts` **GÉNÉRÉ** — passer par la checklist contrat §4 (la vue de lecture nouvelle entre dans `gateway.openapi.ts` + `web:generate-types`).
- **Invalidation du cache** : les mutations de l'écran calendrier (lot 3 — exceptions, périodes, récurrences, import) invalident la clé `calendrier:${etabId}:…` (`viderCacheAsync` ciblé), sinon la sélectionnabilité reste périmée jusqu'au rechargement.
- `apps/web/src/planning/useCalendrierContrat.ts` : `estDansPeriode` (l.181-186) est complété par `serviceOuvert(iso)` (calendrier de l'établissement du contrat, chargé pour le mois affiché) ; `CalendrierCreche` (`joursGardes` l.325-335) et `CalendrierAbcm` (`joursPeriode` l.211-214 ; gardes dans `ouvrirAjustement` l.367 et `ouvrirSaisieAlsh` l.480) refusent les jours fermés avec le **motif** en annonce (`useAnnonce`).
- Affichage : événements de fond `CalendrierMois` (events `allDay` multi-jours, `backgroundColor` distincts vacances/fermeture — FullCalendar le supporte nativement) **+ marqueur non-couleur obligatoire** (libellé/motif dans la cellule ou la modale jour : « Vacances de printemps ») — distinguer par la couleur seule est un angle mort connu de l'audit axe (fiche mémoire `a11y-axe-angles-morts`) ; balayage des contrastes en clair ET sombre. Légende (`LegendePlanning.tsx`) enrichie.
- Dashboard : `SectionDemain` (`DashboardJourPage.tsx:322`)/`RangeeJour` (l.78) affichent le contexte du jour s'il est particulier (« Férié — crèche fermée »).
- Incohérences (CA4) : nouveau composant `IncoherencesCalendrier` sur l'écran calendrier de l'établissement (lot 3) : liste des jours réservés (saisies/planning existants) tombant désormais sur un jour fermé, **bornée aux jours non encore facturés** (le passé est protégé par le versionnement — CA4 révisée par la décision PO du 2026-08-16 ; l'inclure produirait une liste d'alertes sur des mois que plus rien ne peut changer), avec deep-link planning (patron `URLSearchParams` `enfant`/`mode`/`mois` de `DashboardJourPage.tsx:110-118`). Le calcul se fait côté BFF (croisement calendrier × prestations du mois — agrégation lecture seule, patron `apps/api-gateway/src/bff/semaine-besoins.ts`) + checklist contrat §4 si route nouvelle.
- Tests unit + e2e stack : étendre `planning-creche.stack.e2e.spec.ts`/`planning-abcm.stack.e2e.spec.ts` (un jour fermé seedé n'est pas cliquable et affiche son motif).
- **Hors périmètre** : le planning famille (SFD 33) ; toute écriture depuis la vue calendrier.

### Décisions prises

- Le web ne devine jamais : la sélectionnabilité vient du calendrier résolu servi par l'API, pas d'une réimplémentation front des 3 couches.
- Jours fermés = affichés grisés avec motif, **pas masqués** (le parent doit voir pourquoi).
- Pas de blocage rétroactif : une saisie existante sur jour devenu fermé reste lisible (l'incohérence se résout par le parent).

### Critères d'acceptation

- En période scolaire seedée : cantine/péri proposés lun-mar-jeu-ven, mercredi propose ALSH (CA1) ; pendant les vacances seedées : seuls les ALSH sont saisissables (CA2) ; jour férié → non sélectionnable avec motif (CA3).
- Retoucher une fermeture sur un jour réservé → il apparaît dans les incohérences avec lien vers le planning (CA4) ; la retouche invalide le cache calendrier (la sélectionnabilité change sans rechargement).
- Vacances/fermeture distinguées **sans la couleur seule** (marqueur textuel/motif) ; contrastes vérifiés clair + sombre.
- `pnpm nx run-many -t typecheck test lint -p web api-gateway` vert ; e2e stack verte à 375 px.

### Pièges connus

- `viderCacheAsync()` dans les tests (cache `calendrier:` !).
- FullCalendar est lazy-loadé (`PlanningPage.tsx:16-24`) — les tests `PlanningPage` utilisent `findBy…`.
- Ne pas casser la saisie « jour de fermeture = absence » existante côté crèche : un jour fermé n'est **pas** une absence, il ne doit plus être proposé du tout.

---

## RETIRÉE du plan : alerte « vacances sans solution » (US-31-05)

> Section volontairement **non numérotée** depuis le redécoupage du 2026-08-16 : elle portait le numéro « lot 5 », désormais occupé par le lot web. Le contenu ci-dessous est inchangé.

**Décision inter-plans (actée ici, à refléter dans `planning-famille.md` D6)** : ce lot est **retiré** de ce plan et **absorbé par le plan 33 lot 5** (type `CONFLITS_FAMILLE` — CF-03 recouvre entièrement le calcul « jours de vacances sans solution », avec l'acquittement de conflits en plus). Motifs :

- **Travail jeté garanti** : la v1 prévoyait `scheduler.vacances.ts` + route `GET /api/calendrier/vacances-sans-solution` + type `VACANCES_SANS_SOLUTION`, que le plan 33 « absorbait » ensuite — soit une double implémentation, soit un trou.
- **« Ajout additif, aucune migration » était faux** : retirer (ou ajouter) un type de `TYPES_NOTIFICATION` touche **cinq points de contact** — `libs/contracts/foyer/src/lib/events/foyer-events.ts:248-253`, la duplication `apps/api-gateway/src/bff/bff.dto.ts:143`, la projection des préférences `apps/svc-foyer/src/foyer/preferences.util.ts`, `MonProfilPage` (web) et les enums de `gateway.openapi.ts` (l.150/1159) + `openapi-types.gen.ts` régénéré. Un revert n'est pas trivial.
- **Anti-tempête** : l'anti-tempête du récap mardi est le risque confiance n°1 ACTIF — un 2e e-mail hebdo doit s'inscrire dans le même dispositif (plafond/List-Unsubscribe) ; le retrait réduit ce risque à un seul point d'entrée (plan 33).
- **Clé d'idempotence fragile** : `VACANCES_SANS_SOLUTION:${periodeDu}` re-notifie les mêmes vacances si un réimport décale le début d'un jour — la forme 33 (clé par année scolaire + libellé de période) est plus robuste.

**Si le PO exige l'alerte avant le plan 33** : la livrer directement **sous la forme 33** — clé `(annee_scolaire, libellé)`, checklist enum complète (les 5 points ci-dessus), route planification portant `@ScopeFoyerInterServices({ query: 'foyer' })` et client svc-notifications avec `entetesAssertionMachine` (patron `fallback/planification.client.ts` — seule nouvelle surface inter-services, à sécuriser dès le premier commit), scheduler calqué sur `scheduler.hebdo.ts` (horloge injectée `clock.ts`, décision Europe/Paris, dry-run en test — jamais d'envoi réel vers `jaudrey@cscpapin.asso.fr`), horizon paramétrable via `scheduler.options.ts` + passthrough compose `${VAR:-4}` (patron `docker-compose.server.yml:279-296`).

**Conséquences sur ce plan** : `NOTIF_VACANCES_HORIZON_SEMAINES` disparaît du récap ops ; US-31-05 est à signaler au PO comme **reportée** (couverte par le plan 33, CF-03).

---

## Récapitulatif des actions ops (PO — hors code)

0. **PRÉALABLE — train de release n°16 (renvoi : lot R1 du plan `consolidation-ui-et-qualite.md`)** : le prochain train embarque **#257** (PK surrogate projection `grille_tarifaire`, mergé `9818302`, PAS déployé). Après déploiement : **rejouer la projection prod** — `UPDATE grille_abcm SET version_payload = 1;` puis redémarrage de svc-referentiel (**un simple restart ne re-déclenche rien** : `reemettreGrillesEnV2()` filtre `version_payload < 2`) — puis vérifier read-model 9 lignes (3 modes × 3 tranches) et `dead_letter` stable. À faire **AVANT** l'action n°2, sinon repli REST + `dead_letter` parasitent la comparaison de coûts.
1. Aucun nouveau secret, aucune nouvelle variable d'environnement (l'alerte « vacances sans solution » et sa `NOTIF_VACANCES_HORIZON_SEMAINES` sont retirées du plan).
2. Après le train du lot 4 : vérifier le log de reprise (« exceptions crèche créées depuis jour_non_facturable : N » — comptage exact attendu) puis comparer les coûts d'un mois contenant une fermeture avant/après **selon le différentiel à écarts attendus du lot 4** : identiques sur les fériés ; les fermetures crèche non fériées (02–04/01, 15–17/05, 27–31/07) n'excluent plus les modes école — écart **attendu et validé**, pas une anomalie.
3. **Egress** : vérifier depuis le conteneur svc-planification la sortie HTTPS vers `data.education.gouv.fr` (pare-feu DOCKER-USER/ufw-docker — doc 24 — et durcissement A6) avant de déclarer l'import bon pour le service.
4. Action produit : sur l'écran calendrier, **choisir la zone B et le régime Alsace-Moselle** pour l'école, lancer l'import 2026-2027, et vérifier à la rentrée que le calendrier distribué par l'école bilingue colle à la zone B (Q-31-01 — sinon, retouches). Tant que le calendrier de l'école n'est pas configuré, D7 garantit que ses fériés restent fermés (aucune régression férié) ; ses vacances, elles, n'existent qu'après l'import.
