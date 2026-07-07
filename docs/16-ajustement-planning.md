# 16 — Ajustement de planning par jour (ajout / retrait, heures, portée)

|               |                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objet**     | Documenter la fonctionnalité « ajuster le planning d'un enfant **jour par jour** » : ajouter/retirer un jour, saisir une absence (heures d'arrivée/départ), choisir la **portée** (ce mois vs durable).                                      |
| **Date**      | 2026-06-07                                                                                                                                                                                                                                   |
| **Périmètre** | `planification/domain`, `svc-planification`, `api-gateway` (BFF), `svc-notifications` (récap), `apps/web` (planning).                                                                                                                        |
| **Origine**   | Livré au merge `66e79c7` ; documenté ici dans la **phase de consolidation** (voir [doc 06](06-etat-davancement.md)). **Étendu (2026-07-07)** par la catégorie **`ajustements`** (heures réelles, Lot 2a du parcours « valider ma semaine »). |

---

## 1. Principe : des exceptions par date, sans migration

Le planning d'un mois est une **saisie d'exceptions** posées **par dessus** la semaine type du
contrat. Cette saisie est persistée telle quelle dans le **JSONB `planning_mois.saisie`**
(`UNIQUE(contrat_id, mois, simule)`) — **aucune migration** : la structure de table existe depuis la
Phase 5, on n'a fait qu'enrichir la **forme JSON** stockée. La génération des prestations relit ce
JSON et l'applique au domaine pur.

La forme exacte est validée par Zod côté service
([`planification.dto.ts` → `ecrirePlanningSchema`](../apps/svc-planification/src/planification/planification.dto.ts)).
Les modèles d'exception diffèrent selon le mode :

### Côté crèche (PSU) — `JourSupplementaireCreche` & `AbsenceCreche`

Source : [`libs/planification/domain/src/lib/contrat-creche.ts`](../libs/planification/domain/src/lib/contrat-creche.ts).

- **`JourSupplementaireCreche`** (`date`, `duree`) — un jour de garde **ajouté** hors semaine type.
  En PSU la mensualité est **lissée et constante** ; un jour ajouté est donc un **dépassement**, et
  il **s'agrège au complément** du mois (facturé à la minute). Voir `genererPrestationsMois` :
  `complement = (saisie.complement ?? 0) + Σ durées des jours supplémentaires` (filtrés sur le mois
  et la période de validité du contrat).
- **`AbsenceCreche`** (`date?`, `duree`, `preavisJours`, `certificatMaladie`) — un **retrait**.
  La `date` est une **métadonnée** (affichage/persistance) : elle n'entre **pas** dans le calcul.
  Seule la **durée** est déduite, et **uniquement si l'absence est éligible** (préavis ≥ 2 j **ou**
  certificat médical, INV-08). Une absence non éligible reste facturée (incluse dans la mensualité).
- **`AjustementCreche`** (`date`, `presence`, `preavisJours`, `certificatMaladie`) — la **présence
  RÉELLE** d'un jour **contractualisé** (arrivée/départ effectifs), pour représenter « déposé à 8 h au
  lieu de 9 h » ou « récupéré plus tôt » — une arrivée **en avance** était jusque-là irreprésentable.
  Le domaine compare la plage réelle à la/les plage(s) du contrat ce jour-là
  (`SemaineType.plagesJour`) et en dérive deux effets **cumulables** (`ecartAjustement`) :
  - **extension** = minutes présentes **hors** de la plage contractuelle → **complément** (même
    traitement qu'un `JourSupplementaireCreche`) ;
  - **réduction** = minutes de la plage contractuelle **non couvertes** par la présence → **déduction**
    **si éligible**, en réutilisant **la même règle** que les absences (`estDeductible` : préavis ≥ 2 j
    **ou** certificat, INV-08). Sinon les heures réservées restent dues.

  La plage réelle est **stockée telle quelle** (pas un delta) : restituable jour par jour et robuste aux
  évolutions de la semaine type. Contraintes de saisie (erreurs domaine FR) : un ajustement ne porte que
  sur un **jour gardé** (`AjustementJourNonGardeError`, A2) et une date ne peut **cumuler** un ajustement
  avec une autre saisie datée — absence ou jour ajouté (`SaisieJourEnConflitError`, A3). Une présence
  **égale** à la plage du contrat est un **no-op** (pas d'erreur). L'invariant **INV-05** (déduites ≤
  réservées) reste garanti ; les jours à **plusieurs plages** sont gérés (chevauchement mesuré plage par
  plage). La catégorie datée `ajustements` est pilotée par `CATEGORIES_DATEES`
  ([`fenetre.ts`](../libs/shared/semaine/src/lib/fenetre.ts)) → la fusion hebdo et le diff de validation
  la prennent en charge **sans code dédié**, et la forme des prestations générées est **inchangée**
  (contrat implicite avec `svc-tarification`).

> **Compat rétro (diff de validation, `svc-notifications`)** : le diff hebdo compare les jours en **forme
> canonique** sur `CATEGORIES_DATEES` ([`validation.diff.ts`](../apps/svc-notifications/src/validation/validation.diff.ts)) —
> un snapshot figé **avant** l'ajout de la catégorie (sans la clé `ajustements`) reste **équivalent** à un
> snapshot recalculé qui la porte à vide (« catégorie absente ≡ vide »), sans faux « validée avec
> modifications » ni mail parasite au service. Le récap établissement rend un jour ajusté en clair :
> « présence 08:00–16:30 ».

### Côté ABCM — `ExceptionJour`

Source : [`libs/planification/domain/src/lib/inscription-abcm.ts`](../libs/planification/domain/src/lib/inscription-abcm.ts).

- **`ExceptionJour`** (`date`, `cantine?`, `periMatin?`, `periSoir?`) **surcharge la semaine type**
  pour une date précise, **par service**. La règle de fusion (`inscriptionsEffectives`) utilise `??` :
  - champ **présent** (`true` ou `false`) ⇒ **remplace** la semaine type pour ce service ce jour-là
    (donc `false` = retrait **explicite**) ;
  - champ **absent** (`undefined`) ⇒ **hérite** de la semaine type.

  Cela permet d'**ajouter** un service un jour non prévu (`true`) comme d'en **retirer** un jour prévu
  (`false`). L'ALSH reste saisi par **dates explicites** (`joursAlsh`), pas par exceptions.

---

## 2. PSU complément (mensualisé) vs ABCM réservé = facturé

C'est la différence de modèle de facturation qui explique pourquoi « ajouter un jour » ne se traduit
pas pareil selon le mode :

- **Crèche PSU** : le tarif est **mensualisé** (heures annuelles ÷ nombre de mensualités → mensualité
  constante, doc 02 §3.1). La présence « normale » est déjà payée d'avance et lissée ; ce qui bouge la
  facture, c'est le **dépassement**. Donc un jour **ajouté** → **complément** (dépassement à la
  minute), et un jour **retiré** → **déduction** seulement si éligible. La semaine type sert à dériver
  les heures réservées, pas à piloter directement la facture du jour.
- **ABCM** : on est sur du **« réservé = facturé »** (doc 02 §4.4 bis). La **réservation** d'un service
  (cantine / péri matin / péri soir) un jour donné **est** l'unité facturable. Ajouter une réservation
  ⇒ +1 unité facturée ; la retirer ⇒ −1. Pas de mensualisation : l'exception du jour modifie
  directement le compte d'unités du mois (`nbJours`, `nbMatins`, `nbSoirs`).

---

## 3. Saisie crèche en heures d'arrivée/départ

La saisie crèche se fait en **plage horaire** (heures d'**arrivée** et de **départ**), pas en durée
brute. La **durée** est **dérivée côté serveur** : `fin − début`.

- Service : `dureeDePlage(p)` dans
  [`planification.service.ts`](../apps/svc-planification/src/planification/planification.service.ts)
  calcule `fin > debut ? Duree.depuisMinutes(fin − debut) : Duree.zero()`. Une **plage incohérente**
  (départ ≤ arrivée) ⇒ durée nulle ; côté jours supplémentaires elle est **ignorée** (filtre
  `!j.duree.estZero()`), sans gonfler le complément.
- DTO : `absenceCrecheSchema` et `jourSupplementaireSchema` **étendent** `plageHoraireSchema`
  (`debutHeures`/`debutMinutes`/`finHeures`/`finMinutes`) ; le client n'envoie **pas** la durée.
- Front : [`CalendrierCreche.tsx`](../apps/web/src/planning/CalendrierCreche.tsx) saisit deux champs
  `time` (arrivée/départ), valide localement que le départ est postérieur à l'arrivée, et propose une
  case **« Absence toute la journée »** — **cochée par défaut** : l'absence reprend alors la **plage de
  garde du contrat** pour ce jour (arrivée du 1ᵉʳ créneau → départ du dernier). Décochée, on saisit une
  **absence partielle** sur des heures précises.

> ABCM n'utilise **pas** d'heures : la saisie est faite de **cases à cocher** (cantine / matin / soir),
> reflétant `ExceptionJour`.

---

## 4. Portée : ponctuelle (« ce mois ») vs durable (« tous les mois »)

À chaque ajustement, l'utilisateur choisit la **portée** via
[`ChoixPortee`](../apps/web/src/planning/ChoixPortee.tsx) (`'mois'` par défaut, le cas le plus fréquent
et le moins risqué) :

- **« Ce mois uniquement »** → écrit la **saisie du mois** (`PUT …/plannings/:mois`,
  `planning_mois.saisie`). Le contrat n'est pas touché : c'est une exception ponctuelle.
- **« Tous les mois (modifie le contrat) »** → modifie **durablement** la semaine type du contrat via
  `api.modifierContrat` (BFF → `PUT /api/contrats/:id`, service `modifierContrat`). Cette opération
  **cascade-supprime** les `planning_mois` du contrat (les saisies mensuelles existantes deviennent
  incohérentes après un changement de mode/dates/semaine type — voir `modifierContrat` :
  `tx.delete(planningMois)…`). Le front confirme donc cette action par une
  [`ModaleConfirmation`](../apps/web/src/ui/ModaleConfirmation.tsx) **destructive** (focus initial sur
  « Annuler ») prévenant que les saisies mensuelles seront réinitialisées.

---

## 5. Durabilité multi-poste (réhydratation depuis le serveur)

La source de vérité d'une saisie est `planning_mois.saisie`, pas le navigateur. La saisie est donc
**relisible** et **réhydratée** au chargement d'un mois :

- Endpoint service : `GET /api/contrats/:id/plannings/:mois?simule=` →
  `PlanificationService.lirePlanning`, qui renvoie `{ saisie: EcrirePlanningDto | null }` (`null` si
  rien d'enregistré pour ce couple, **200 et non 204**).
- **BFF passthrough** : `GET /api/v1/contrats/:id/plannings/:mois`
  ([`contrats.controller.ts`](../apps/api-gateway/src/bff/contrats.controller.ts)) relaie vers le
  client résilient `PlanificationClient.lirePlanning`. Path publié dans l'OpenAPI
  ([`gateway.openapi.ts`](../libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts),
  `'/api/v1/contrats/{id}/plannings/{mois}'`).
- Côté app : le hook [`useSaisieServeur`](../apps/web/src/planning/useSaisieServeur.ts) appelle
  `api.lirePlanning` et expose `{ saisie, chargee }`. Règle de réhydratation :
  - tant que la réponse n'est pas arrivée (`chargee === false`), le calendrier affiche son **brouillon
    local** (sessionStorage, via `usePersistanceAbsences`) ;
  - quand le serveur répond une saisie, **elle devient la source de vérité** (et écrase le brouillon) ;
  - si le serveur répond **`null`** (rien d'enregistré) ou en cas d'**erreur réseau**, on **ne
    réécrit pas** par-dessus le brouillon local — la saisie en cours n'est jamais perdue.

Le sessionStorage n'est donc qu'un **brouillon** ; un autre poste retrouve la saisie via le serveur.

### 5.1 Garde anti-écrasement (édition pendant le chargement)

Le calendrier s'affiche depuis le brouillon local **avant** que le `GET` de réhydratation ne réponde :
un parent peut donc éditer un jour **pendant** cette fenêtre de chargement (fréquent en 4G lente). Sans
garde, la réponse — plus **ancienne** que l'édition — écraserait la saisie fraîche à son arrivée : l'UI
« revient en arrière » quelques instants (le `PUT` debouncé finit par persister, donc auto-guérison au
prochain chargement, mais le clignotement est une régression visible). C'est la course qui rendait aussi
les specs e2e stack flaky (une absence supprimée « réapparaissait » en « Ajusté »).

Solution : une **séquence d'édition locale monotone**. [`useCalendrierContrat`](../apps/web/src/planning/useCalendrierContrat.ts)
tient un compteur (`seqMutationRef`) et expose `marquerSaisieLocale()` — appelé à chaque mutation locale
(via `envoyer`, point de passage unique des éditions) — et `saisieServeurObsolete()`.
[`useSaisieServeur`](../apps/web/src/planning/useSaisieServeur.ts) **fige** la valeur du compteur **au
lancement du `GET`** (`seqAuChargement`). L'effet de réhydratation ignore la réponse quand
`seqMutationRef.current > seqAuChargement` (une édition est survenue depuis) :

- **édition pendant le chargement** → le `GET` périmé est ignoré, l'édition prime ;
- **montage propre** (aucune édition) → `seqAuChargement` inchangé, le serveur reste **source de vérité**.

> ⚠️ Le lecteur `lireSeqLocale` passé à `useSaisieServeur` doit avoir une **identité stable**
> (`useCallback([])`), sinon l'effet du `GET` se redéclenche à chaque rendu (boucle de refetch).

---

## 6. Tests associés

- **Domaine (unitaires `planification-domain`)** :
  - [`contrat-creche.spec.ts`](../libs/planification/domain/src/lib/contrat-creche.spec.ts) — jours
    supplémentaires agrégés au complément, déduction d'absence éligible, indépendance de `date` ; et
    **ajustements** : extension → complément, réduction éligible / non éligible, mixte, no-op, jour non
    gardé (A2), double saisie (A3), jours multi-plages.
  - [`contrat-creche.mbt.spec.ts`](../libs/planification/domain/src/lib/contrat-creche.mbt.spec.ts) —
    BVA + property-based sur l'écart présence/contrat et **INV-05** avec réduction d'ajustement.
  - [`generation-prestations.spec.ts`](../libs/planification/domain/src/lib/generation-prestations.spec.ts) —
    pont JSON `ajustements` → extension/déduction.
  - [`inscription-abcm.spec.ts`](../libs/planification/domain/src/lib/inscription-abcm.spec.ts) —
    `ExceptionJour` : ajout (`true`), retrait explicite (`false`), héritage (`undefined`).
- **Web (composant)** :
  - [`CalendrierCreche.test.tsx`](../apps/web/src/planning/CalendrierCreche.test.tsx) — heures
    arrivée/départ, « absence toute la journée », ajout/retrait, choix de portée + confirmation, et
    **garde anti-écrasement** (§5.1 : une édition faite pendant un `GET` lent survit à sa résolution ;
    contre-épreuve : sans édition, le `GET` lent réhydrate bien).
  - [`CalendrierAbcm.test.tsx`](../apps/web/src/planning/CalendrierAbcm.test.tsx) (dont la même garde
    anti-écrasement), [`PlanningPage.test.tsx`](../apps/web/src/planning/PlanningPage.test.tsx).
  - [`useSaisieServeur.test.ts`](../apps/web/src/planning/useSaisieServeur.test.ts) — round-trip exact,
    abort au démontage, et capture du compteur d'édition figé au lancement du `GET` (`seqAuChargement`).
- **Pact** : [`planification.consumer.pact.spec.ts`](../apps/api-gateway/src/contract/planification.consumer.pact.spec.ts)
  (relecture `GET …/plannings/:mois` : saisie présente vs `{ saisie: null }`) ; vérifié côté provider
  par [`planification.provider.pact.spec.ts`](../apps/svc-planification/src/contract/planification.provider.pact.spec.ts).
- **E2E stack réelle** :
  [`planning-ajustement.stack.e2e.spec.ts`](../apps/web/e2e/planning-ajustement.stack.e2e.spec.ts) —
  parcours complet d'ajustement contre la pile réelle (cf. [doc 15](15-spec-tests-e2e-stack-reelle.md)).

> Commandes : `pnpm nx test planification-domain`, `pnpm nx test web`, `pnpm nx test api-gateway`
> (pacts consumer), `pnpm e2e:stack`.
