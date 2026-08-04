# Plan — Factures réelles : rapprochement budgétaire & crédit d'impôt

> **Statut : BROUILLON — à valider PO (lot 0 bloquant, cf. §Hypothèses).** Rédigé avant le
> 2026-07-30 (ex `streamed-juggling-pudding.md`, jamais ancré au code) ; **ré-ancré le
> 2026-07-30 sur main `9aee291` (prod `0.14.0`)**. Repères de lignes : relevés le 2026-07-30
> sur main `9aee291`. La copie de travail porte des modifs non commitées (`apps/web/src/App.tsx`,
> `App.test.tsx`, `styles.css`, `planning/BarreStatutCalendrier.tsx` — chantier nav mobile) :
> re-vérifier les repères `apps/web` à l'exécution, et atterrir ce chantier (lot C0 du plan
> consolidation) AVANT les lots UI (B3/C3/D).

## Séquencement inter-chantiers & dépendances (état au 2026-07-30)

| Dépendance                                                                                  | État réel                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan 30 « versionnement dates d'effet » (SFD 30)                                            | **LIVRÉ** — 7/7 lots, prod `0.14.0` (2026-07-29). Socle réel : `libs/shared-kernel/src/lib/versionnement.ts` (`PeriodeValidite` l.30, `Versionne` l.115, `selectionnerVersionApplicable` l.129, `depuisBornes` l.192, `depuisSuite` l.211) ; modes consolidés `libs/contracts/kernel/src/lib/modes.ts` ; grilles servies par la projection Référentiel (`GrillePubliee.v2`), plus AUCUNE constante tarifaire dans le domaine (RM-30-04). Ce plan s'y ancre (A1, C1). |
| Correctif **#257** (PK surrogate projection `grille_tarifaire`, défaut du lot 2 du plan 30) | Mergé main `9818302`, **PAS ENCORE DÉPLOYÉ** — nécessite un rejeu de projection prod (≠ simple restart), embarqué par le **train de release n°16** (lot R1 du plan `consolidation-ui-et-qualite.md`, qui le référence seul — ce plan y renvoie). Leçon directe pour B1 (cf. Phase B).                                                                                                                                                                                |
| Agrégation annuelle + `CoutAnnuelVue` (svc-tarification)                                    | Livré, stable — `cout.service.ts:161`, routes `/api/v1/couts` + `/couts/annuel` derrière la gateway avec `@FoyerScope('query:foyer')` (`bff/couts.controller.ts:21,38`). Extension additive possible.                                                                                                                                                                                                                                                                |
| SFD 32 « travail/congés/revenus » (svc-famille, `MontantDevise`)                            | **NON lancée** — `MontantDevise` absent de shared-kernel (hypothèse H3 EUR-only). La checklist « nouveau service » de son **lot 1** (`.claude/plans/travail-conges-revenus.md`, § « Lot 1 — Socle svc-famille », complétée le 2026-07-30) est la **référence canonique** que A3 réutilise.                                                                                                                                                                           |
| Fondations backend (assertion HMAC inter-services)                                          | Livré **OBSERVE-ONLY** (prod `0.13.0`) ; bascule `INTERSERVICE_AUTHZ_ENFORCE=1` prévue après ~1 semaine de logs propres post-train n°16 — elle arrivera PENDANT ou AVANT ce chantier. Tout nouveau service livré sans `AssertionIdentiteModule` serait cassé net à la bascule → intégré dès A3.                                                                                                                                                                      |

**Ordre d'exécution global recommandé** : consolidation (R1 + B/C/D) → SFD 31 → SFD 32 →
SFD 33 → **ce plan en DERNIER** — au plus tôt après le lot 1 du plan 32, jamais avant : le
socle A3 réutilise la checklist canonique corrigée du 32 lot 1. Si le PO priorise le crédit
d'impôt (échéance déclarative), le chantier peut s'intercaler dès la fin du 32 lot 1. Les
chantiers touchant `gateway.openapi.ts` / `bff.dto.ts` / `scripts/services.json` s'exécutent
**séquentiellement** (deux chantiers parallèles sur ces fichiers = conflits garantis).

**Topologie — réservation croisée (écrite aussi dans le plan 32, lot 1 item 12)** :
`svc-facturation` = port **3003** (libre : 3000 gateway, 3001 referentiel, 3002 foyer,
3004 planification, 3005 tarification, 3006 notifications) + stream **`FACTURATION`**
(sujet `facturation.>`). `svc-famille` (plans 32/33) = port 3007 + stream `FAMILLE`.
`scripts/services.json` reste la source unique de topologie.

**Renvoi vers le plan 32 lot 5** : quand ce plan livrera, la ligne « Frais de garde du mois »
du tableau revenus (CA3 du 32, branchée sur `api.lireCoutMois` = coût **calculé**) pourra
basculer sur le **facturé réel** — petit lot de branchement à prévoir côté 32, pas ici.

---

## Context

Le système est aujourd'hui un **moteur de calcul budgétaire** : à partir du foyer, des contrats
et du planning, `svc-tarification` calcule un coût _théorique_. Il n'existe **aucune notion de
montant réellement facturé** par la crèche/ABCM — ni facture, ni paiement, ni justificatif.

On introduit la **vérité terrain** (la facture émise par la structure) pour débloquer deux usages
demandés :

1. **Budget réel vs prévisionnel** — comparer, mois par mois et **ligne par ligne**, le coût
   _calculé par le modèle_ au _montant réellement facturé_, et exposer l'écart.
2. **Crédit d'impôt frais de garde** — calculé sur les **sommes réellement payées** (les factures),
   pas sur le coût modélisé.

Chemin de saisie **nominal v1 : saisie manuelle** (formulaire pré-structuré). L'**import
PDF/photo (OCR)** est un lot **optionnel et conditionné** (H1) avec **validation humaine
obligatoire** avant enregistrement. Le **document original est archivé** (justificatif).
Rapprochement **ligne par ligne**.

> ⚠️ Vocabulaire : l'axe existant `simule` oppose _planning réel_ vs _planning hypothétique_, tous
> deux valorisés par le modèle (`planification-events.ts:116`, `CoutMoisVue.simule`
> `cout.service.ts:154`). La facture est un **axe distinct** (montant facturé = vérité terrain).
> On ne réutilise PAS le flag `simule` pour les factures.

### Règles fiscales retenues (crédit d'impôt frais de garde — à versionner par année fiscale)

Sources : [service-public.gouv.fr/F8](https://www.service-public.gouv.fr/particuliers/vosdroits/F8),
[impots.gouv.fr](https://www.impots.gouv.fr/particulier/questions/je-fais-garder-mon-jeune-enfant-lexterieur-du-domicile-que-puis-je-deduire).

- **50 %** des dépenses de garde, **plafond 3 500 €/enfant/an** → crédit max **1 750 €/enfant**
  (revenus 2025, déclaration 2026). **Moitié** (1 750 € plafond, 875 € crédit) en garde alternée (H4).
- Enfant **< 6 ans au 1ᵉʳ janvier de l'année des revenus** (né à partir du 01/01/2019 pour 2025).
- **Éligibles** : crèche (`CRECHE_PSU`), **périscolaire** (`PERISCOLAIRE`), **ALSH** (`ALSH`).
  L'assistant·e maternel·le est fiscalement éligible mais **aucun mode du système ne le
  représente** → hors périmètre v1 (H8).
- **Non éligibles** : **cantine** (`CANTINE`, dépense courante) et **toute ligne de nature repas/
  nourriture** (à exclure même sur une facture par ailleurs éligible).
- À **déduire** : aides CAF (CMG) et aides employeur (champ de saisie prévu, défaut 0).
- Année fiscale de rattachement : **année de la `datePaiement`** proposée (H5 — un paiement en
  janvier N+1 change le crédit de N vers N+1).

---

## Hypothèses à valider PO (lot 0 — bloquant avant exécution)

- **H1 — OCR = appel API Anthropic** : service externe payant (clé `ANTHROPIC_API_KEY` en prod),
  PII transmise à un tiers (noms des enfants, adresse, montants) avec **rétention 30 j** côté
  Anthropic. Alternative : saisie manuelle seule en v1 (le repli « brouillon vide → saisie
  manuelle » devient le chemin nominal — c'est le re-séquencement proposé ici). Consentement PO
  explicite requis pour activer le lot OCR (A4), avec coût unitaire chiffré (cf. A4).
- **H2 — Stockage justificatifs** : `bytea` Postgres, **taille max proposée 10 Mo/fichier**,
  rétention/purge à définir (durée légale justificatifs fiscaux ?), **impact sauvegardes à
  chiffrer** — les dumps nightly grossiront (incident « 0 backup depuis le 17/06 » à peine
  résolu, cf. §Exploitation), temps de restore à re-mesurer.
- **H3 — Devise : EUR-only assumé** (`Money` centimes). Ne PAS attendre `MontantDevise`
  (RM-32-03, plan 32 non lancé) : les factures crèche/ABCM sont en EUR. Articulation future à
  poser dans le plan 32, pas ici.
- **H4 — Garde alternée** : le flag est saisi **par enfant** mais svc-tarification est un read
  model sans chemin d'écriture. Lieu de persistance à trancher en cohérence avec le modèle
  membre/enfant des plans 32/33 : **svc-foyer** (attribut de l'enfant, projeté vers tarification
  comme `dateNaissance`) est l'option recommandée ; le porter sur la facture serait un attribut
  orphelin.
- **H5 — Année fiscale** = année de la `datePaiement` (pas du mois de facture). À confirmer.
- **H6 — Avoirs / factures négatives** (crédits > débits) : autorisés ou interdits ? Le calque
  naïf de `CoutMois.total` **lève** via `Money.moins` (INV-06, `cout-mois.ts:34-54`) — l'invariant
  de `FactureReelle` doit être une décision explicite (cf. A1).
- **H7 — Barème crédit d'impôt** : barème LÉGAL national — reste-t-il une **constante domaine
  versionnée** (via `versionnement.ts` ; RM-30-04 vise les tarifs de structure, pas la loi) ou
  passe-t-il par le **Référentiel seedé** comme les grilles ? Constante domaine versionnée
  proposée (cf. C1).
- **H8 — Assistant·e maternel·le** : éligible fiscalement, non représentable (aucun mode) →
  hors périmètre v1, à acter.
- **H9 — Deux notions fiscales distinctes** : le crédit d'impôt frais de garde (CE plan) ≠ la
  vue « après impôt au taux moyen » du plan 32 lot 5 (impôt sur le REVENU, docs/32 §« deux vues
  impôt »). À clarifier avec le PO, avec l'articulation future « le crédit calculé ici alimente
  la vue revenus ».

---

## Architecture (CQRS conforme à l'existant)

- **Écriture** → nouveau service `svc-facturation` (port 3003, stream `FACTURATION`) : saisie
  (+ OCR si H1 validée) + validation + persistance + archivage du document + émission
  d'événements `FactureEnregistree` / `FactureSupprimee`.
- **Lecture/calcul** → on étend `svc-tarification` (déjà détenteur de `enfant.dateNaissance`
  projetée — `database/schema.ts:110`, `projection.service.ts:297,305` — de l'agrégation
  annuelle et de la surface `CoutAnnuelVue`) : il projette les factures dans son read model,
  puis calcule le **rapprochement** et le **crédit d'impôt**.
- **BFF** → `api-gateway` relaie : écritures (et upload multipart si OCR) vers `svc-facturation`,
  lectures vers `svc-tarification`. Toutes les routes scopées `@FoyerScope`.
- **Front** → `apps/web` : écran saisie/liste des factures (+ import OCR si H1), colonne
  « Facturé » + delta sur Coûts annuels, encart crédit d'impôt.

Patterns de référence à copier à l'identique (voir tableau en fin de doc).

### Volet transversal « contrats & CI » — à répéter à CHAQUE phase exposant une route

Aucune route gateway n'existe sans ces quatre gestes (sinon CI rouge garantie) :

1. **OpenAPI** : étendre `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` (document
   typé maintenu à la main) ET bumper l'oracle `gateway.openapi.spec.ts:14` (« expose exactement
   les **27** routes attendues » → 27+N).
2. **Types front** : `pnpm nx run web:generate-types` régénère
   `apps/web/src/api/openapi-types.gen.ts` (job CI `openapi-types-drift`) — les types « étendus »
   de B3/C3/D passent par ce circuit, JAMAIS par édition manuelle.
3. **Pact** : nouveau consumer `apps/api-gateway/src/contract/facturation.consumer.pact.spec.ts`
   (calquer les 5 existants) + provider `apps/svc-facturation/src/contract/*.provider.pact.spec.ts` ;
   re-vérifier le provider `tarification.provider.pact.spec.ts` (vues enrichies B2/C2) ;
   `scripts/services.json` : `servicesApplicatifs` += `svc-facturation` ET `providersPact` +=
   `svc-facturation` (consommé par `can-i-deploy.mjs` ; la vérification cosign de TOUTES les
   images en découle — `deploy.mjs:86,498`, Porte 1bis). Piège connu : `/pacts` est dans
   `.prettierignore` (sinon lint-staged casse pact-drift).
4. **Couverture** : la CI a une gate baseline (échec si −0,5 pt de lignes vs main) — tout code
   neuf massif (un service entier !) livre ses specs dans le même lot.

---

## Phase A — Socle facturation (côté écriture)

### A1. Domaine `libs/facturation/domain` (vitest 100 %)

Calquer `libs/foyer/domain` (constructeur privé + `static creer()` + invariants → `DomainError`,
immuabilité, `Money` en centimes).

- `lib/mode-contrat.ts` — **miroir local documenté** de l'union `ModeContrat`
  (`'CRECHE_PSU' | 'PERISCOLAIRE' | 'CANTINE' | 'ALSH'`). ⚠️ `ModeGarde` n'existe PLUS dans
  `tarification-domain` : renommé `PolitiqueTarifaireId` par le plan 30 lot 7 (#239), union
  élargie à 6 valeurs (+ `FRAIS_FIXES_ABCM`, `UNITES_ASSOCIATIVES`) qui n'est PAS un mode de
  contrat (`politique-tarifaire.ts:12-18`). La source de vérité inter-services est
  `libs/contracts/kernel/src/lib/modes.ts:11-18` (`MODES_CONTRAT`/`ModeContrat`, + `MODES_ABCM`,
  `estModeAbcm`), mais la frontière Nx interdit domain→contracts (`@nx/enforce-module-boundaries`)
  → miroir local tenu identique par convention, patron exact :
  `libs/referentiel/domain/src/lib/mode-garde.ts:13` (convention transversale « miroir de
  modes » partagée avec le plan 31 D1 et le résiduel D4 de consolidation). Import de
  `contracts-kernel` partout ailleurs (service, gateway, web).
- `lib/nature-ligne-facture.ts` — type `NatureLigneFacture` :
  `'base' | 'complement' | 'deduction' | 'seance' | 'journee' | 'repas' | 'frais' | 'autre'`
  \+ helper `estNatureRepas(nature)`. ⚠️ Cette taxonomie est à **CRÉER**, pas à réutiliser :
  `LigneDeCout` n'a AUCUN champ nature — uniquement `libelle`/`montant`/`sens`
  (`cout-mois.ts:14-19`) ; les « natures » ne figurent qu'en commentaire doc (qui cite aussi
  « journée » ALSH, d'où son ajout à l'union). Le rapprochement ligne à ligne de B2 exigera
  d'introduire la même taxonomie côté lignes calculées.
- `lib/ligne-facture.ts` — VO `LigneFacture { libelle, montant: Money, nature, sens: 'debit'|'credit' }`.
- `lib/facture.ts` — agrégat `FactureReelle` :
  - champs : `foyerId`, `enfantId?`, `contratId?`, `mode?: ModeContrat`, `emetteur: string`,
    `mois: string (YYYY-MM)`, `lignes: readonly LigneFacture[]`, `aidesDeduitesCentimes`,
    `statut: 'a_payer' | 'payee'`, `datePaiement?: string`.
  - dérivé : `total: Money` (Σ débits − Σ crédits). ⚠️ NE PAS calquer `CoutMois.total`
    aveuglément : il **lève** via `Money.moins` si crédits > débits (INV-06 coût mensuel ≥ 0,
    `cout-mois.ts:34-54`) — une facture d'avoir exploserait. Invariant à décider selon H6
    (interdire avec erreur dédiée `FactureAvoirNonSupporteeError`, OU autoriser un total signé).
  - invariants : `mois` au format `YYYY-MM`, au moins une ligne, montants ≥ 0, `datePaiement`
    requise si `statut = 'payee'`.
- `lib/facturation-error.ts` — erreurs `MoisInvalideError`, `FactureVideError`, etc. (héritent
  `DomainError`).
- `src/index.ts` — exports publics.
- `package.json` — tags `type:domain,context:facturation`, dépend de `shared-kernel` SEUL
  (pas de dépendance tarification-domain ni contracts — cf. miroir ci-dessus).
- **Frontières Nx** : enregistrer `context:facturation` dans les `depConstraints` de
  `eslint.config.mjs` (comme le 32 lot 1 item 11 pour `context:famille`) — sans enregistrement,
  un contexte n'est PAS contraint et dérive silencieusement.

### A2. Contrats d'événements `libs/contracts/facturation`

Calquer `libs/contracts/foyer` (enveloppe :
`libs/contracts/kernel/src/lib/events/integration-event.ts`).

- **`facturation.FactureEnregistree.v1`** (Zod + `integrationEventSchema`). Payload : `factureId`,
  `foyerId`, `enfantId?`, `contratId?`, `mode?`, `emetteur`, `mois`, `lignes[]` (libelle,
  montantCentimes, nature, sens), `aidesDeduitesCentimes`, `statut`, `datePaiement?`.
  Ré-émis à chaque **create ET update** (correction, marquage payé) — l'update n'a pas
  d'événement dédié, la projection est un upsert par `factureId`.
- **`facturation.FactureSupprimee.v1`** — payload `{ factureId, foyerId }`. ⚠️ Sans lui, le
  DELETE de A3 laisserait des factures fantômes dans le read model de tarification
  (rapprochement et crédit d'impôt FAUX). Émis dans la même transaction que la suppression.
- Constante `FACTURATION_EVENT_SOURCE = 'svc-facturation'` (patron `FOYER_EVENT_SOURCE`,
  consommé par `OutboxModule.forRoot` — `svc-foyer/src/app.module.ts:40`). + specs de
  validation (payloads bien/mal formés).

### A3. Service `apps/svc-facturation`

**Socle : appliquer la checklist canonique « nouveau service » du plan 32 lot 1**
(`.claude/plans/travail-conges-revenus.md`, § « Lot 1 — Socle svc-famille », 12 items +
critères d'acceptation + pièges), en substituant : `svc-facturation`, port **3003**, stream
**`FACTURATION`**, sujet `facturation.>`, base `postgres-facturation`, tags
`type:app,context:facturation`. Elle couvre : main/app.module/config/tracing, compose ×3
(healthcheck node A6, `mem_limit`/`cpus`), `services.json`, prometheus, `e2e-stack.mjs`,
smoke-stack, `.env.server.example`, **les 4 scripts de backup** (cf. §Exploitation), gateway
`facturationUrl`, depConstraints. Détail exploitation : §Exploitation ci-dessous. S'y ajoute
le métier :

- **`AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig, scoping: {} })` dès le
  premier commit** — svc-facturation scope en direct comme svc-tarification
  (`svc-tarification/src/app.module.ts:41`) : les routes portent `?foyer=`/`foyerId`, pas de
  résolveur en base nécessaire (le GET/DELETE `/:id` résout le foyer depuis la ligne facture →
  petit résolveur local si besoin, patron `svc-planification`). Sans ce module, le service est
  cassé net à la bascule `INTERSERVICE_AUTHZ_ENFORCE=1`.
- `database/schema.ts` :
  - table `facture` — **PK surrogate `id uuid defaultRandom()`** (leçon #257 : jamais de PK
    métier sur une projection/table à clé composite ambiguë), centimes en `bigint`,
    `mois varchar(7)`, `statut`, `date_paiement date null`, `emetteur`, `foyer_id`,
    `enfant_id null`, `contrat_id null`, `mode varchar(32) null`,
    `aides_deduites_centimes bigint default 0`, timestamps, + colonne `empreinte_dedup`
    (cf. dédup ci-dessous) avec index unique.
  - table `facture_ligne` (FK `facture_id` cascade, `libelle`, `montant_centimes bigint`,
    `nature`, `sens`). _(préférer la table dédiée au `jsonb` pour le requêtage ligne à ligne.)_
  - table `facture_document` (FK `facture_id`, `contenu bytea`, `type_mime`, `nom_fichier`,
    `taille`) — archivage du PDF/photo, taille plafonnée (H2).
  - tables `outbox`, `dead_letter` (copies structurelles typecheckées contre nest-commons,
    comme le 32 lot 1 item 1).
- `facturation/facture.dto.ts` — schémas Zod : `creerFactureSchema` (saisie validée par
  l'utilisateur), filtres de liste. `ZodValidationPipe` repris tel quel.
- `facturation/facture.controller.ts` :
  - `POST /api/factures` — corps = facture **validée** (+ document joint optionnel) → persiste
    (`FactureReelle.creer`), archive le document, insère `FactureEnregistree` dans l'outbox
    **dans la même transaction**, renvoie la vue.
    **Idempotence d'écriture** : clé de dédup serveur `empreinte_dedup = SHA-256(foyerId +
mois + emetteur + totalCentimes [+ hash du document si joint])` → conflit = **409** (un
    POST rejoué sur retry réseau ou double-clic ne crée pas de doublon ; le client web ne
    rejoue que les requêtes idempotentes, mais rien ne protégeait côté serveur).
  - `GET /api/factures?foyer=UUID&annee=YYYY` — liste.
  - `GET /api/factures/:id` / `GET /api/factures/:id/document` (flux du bytea).
  - `PUT /api/factures/:id` (corriger / marquer payée) → ré-émet `FactureEnregistree`.
  - `DELETE /api/factures/:id` → supprime ET émet `FactureSupprimee` **dans la même
    transaction**.
  - `POST /api/factures/ocr` — **UNIQUEMENT si lot A4 activé (H1)** : multipart (PDF/photo)
    → renvoie un **brouillon** extrait (non persisté). Champ `foyer` multipart **obligatoire**
    (route coûteuse, cf. A5).
- `facturation/facture.service.ts` — conversions DTO(euros)→domaine(Money)→BD(centimes),
  transactions Drizzle + outbox, vues HTTP.
- Upload multipart NestJS : ⚠️ contrairement au brouillon initial, `@nestjs/platform-express`
  est DÉJÀ dépendance racine (adaptateur HTTP de tous les services, `package.json:79`) et
  `multer` est déjà épinglé en override pnpm `^2.2.0` (pin sécurité transitive,
  `package.json:72`). Le vraiment nouveau : usage de `FileInterceptor`, dépendance dev
  `@types/multer`, et le relais multipart binaire à travers la gateway (aucun `FileInterceptor`
  dans le code actuel). Nécessaire seulement pour le document joint (A3) et l'OCR (A4).

### A4. OCR via API Anthropic (Claude vision) — **lot OPTIONNEL, conditionné à H1**

Livrable séparément, APRÈS l'incrément v1 (saisie manuelle). Ne bloque ni B, ni C, ni D.

- `facturation/ocr/ocr.service.ts` — appelle l'**API Messages Anthropic** avec le document
  (bloc `document` PDF base64 ou `image`) + **sortie structurée `output_config.format`
  (json_schema)** — c'est la voie recommandée actuelle, PAS le tool use forcé — renvoyant
  `{ emetteur, mois (YYYY-MM), lignes:[{libelle, montant, nature, sens}], total, confiance }`.
  Modèle par défaut **`claude-opus-5`** (5 $/25 $ par Mtok — même tarif que `claude-opus-4-8`,
  plus capable, défaut recommandé) ; option coût **`claude-sonnet-5`** (3 $/15 $, intro
  2 $/10 $ jusqu'au 2026-08-31). Gérer `stop_reason === 'refusal'` avant de lire `content`.
  Clé API via `config.ts` (`ANTHROPIC_API_KEY`, absente ⇒ OCR désactivé proprement).
- **Prompt caching — piège** : le préfixe cachable minimal est **1024 tokens** sur opus-4-8 et
  sonnet-5 (**512** sur opus-5) — une instruction système courte ne cachera RIEN,
  silencieusement (`cache_creation_input_tokens: 0`). Et le bénéfice est de toute façon limité :
  le document varie à chaque appel. Ne cacher que si l'instruction système dépasse le minimum ;
  vérifier via `usage.cache_read_input_tokens`.
- **Coût à chiffrer au lot 0** : ~1 500-4 800 tokens/page selon la résolution + sortie JSON ;
  ordre de grandeur quelques centimes/facture sur opus-5 — plafonner par un compteur mensuel
  (variable d'env `OCR_FACTURE_BUDGET_MENSUEL`, refus au-delà).
- **Stub CI/e2e obligatoire** : flag `OCR_FACTURE_STUB=1` → le service renvoie un brouillon
  déterministe sans appel réseau (e2e-stack et smoke-stack n'ont pas d'accès Internet garanti,
  et on ne facture pas l'API à chaque CI).
- **Critère d'acceptation manuel (hors CI, stub désactivé)** : `POST /api/v1/factures/ocr`
  avec un **PDF de facture réel** (`ANTHROPIC_API_KEY` réelle, en local ou staging) → vérifier
  le brouillon extrait (émetteur, `mois` au format `YYYY-MM`, lignes avec natures/montants
  plausibles, total cohérent). Le stub ne teste que la plomberie, pas la qualité
  d'extraction — ce contrôle sur document réel conditionne l'acceptation du lot.
- Le service **classe** chaque ligne dans une `NatureLigneFacture` et propose `mode`/`emetteur` ;
  l'utilisateur corrige à l'écran (A4 n'a pas autorité, la **validation humaine fait foi**).
- Résilience : si l'OCR échoue/incertain, renvoyer un brouillon vide → saisie manuelle.
- **Exploitation (si activé)** : secret `ANTHROPIC_API_KEY` posé via sops+age ; egress du
  conteneur vers `api.anthropic.com` à valider contre le durcissement conteneurs (lot A6) ;
  latence vision (plusieurs secondes) vs timeouts d'`executerResilient` et du relais multipart
  gateway → timeout dédié plus large sur cette route ; PII envoyée à un tiers (rétention 30 j) =
  consentement PO explicite (H1).

### A5. BFF `apps/api-gateway`

- `clients/facturation.client.ts` — calquer le helper **`appelResilient`**
  (`clients/appel-resilient.ts:73` — timeout/retry/circuit-breaker + **propagation de
  l'assertion d'identité sur chaque appel sortant**, patron `referentiel.client`), plus récent
  que l'usage direct d'`executerResilient` du `tarification.client.ts`. Méthodes : `creer(dto)`,
  `lister(foyer, annee)`, `obtenir(id)`, `document(id)`, `supprimer(id)`, `mettreAJour(id, dto)`,
  (+ `ocr(fichier, foyer)` si A4).
- `bff/factures.controller.ts` — `@Controller({ path: 'factures', version: '1' })`, validations
  Zod (`moisSchema`, foyer requis), `relayer(...)` (calquer `bff/couts.controller.ts:15-56`).
  **Isolation foyer sur CHAQUE route** (le décorateur supporte `body:<nom>` —
  `security/foyer-scope.ts:27-32`) :
  - `POST /api/v1/factures` → `@FoyerScope('body:foyerId')` ;
  - `GET /api/v1/factures` → `@FoyerScope('query:foyer')` ;
  - `GET/PUT/DELETE /api/v1/factures/:id` + `/document` → scoping par ressource (résolution
    factureId→foyer côté svc-facturation, assertion propagée) ;
  - `POST /api/v1/factures/ocr` (si A4) → champ multipart `foyer` **obligatoire** +
    `@FoyerScope('body:foyer')` + **rate-limit dédié** (route coûteuse : appel Anthropic
    facturé — sans contrôle d'appartenance ni limite, c'est un robinet à dollars).
- `config.ts` — ajouter `facturationUrl` (patron des `*Url`, `config.ts:34-40` + parsing
  l.161-168 ; env `FACTURATION_URL`, défaut `http://localhost:3003`).
- **Volet contrats & CI** (cf. section transversale) : openapi + oracle 27→N + generate-types +
  pact consumer/provider + services.json.

---

## Phase B — Rapprochement calculé vs facturé (côté lecture, `svc-tarification`)

### B1. Projection des factures dans le read model

- `database/schema.ts` (svc-tarification) : nouvelles tables `facture_reelle` +
  `facture_reelle_ligne`. **Blindage contre la classe de bug #257** (PK métier + événements
  partageant la clé → dead-letter en masse, read model partiel — c'est EXACTEMENT ce qui est
  arrivé à `grille_tarifaire` en prod `0.14.0`) :
  - **PK surrogate `id uuid defaultRandom()` d'emblée** ; `facture_id` amont en colonne
    d'unicité (index unique séparé), PAS en PK ;
  - l'unicité métier `(foyer_id, mois, enfant_id, emetteur)` du brouillon initial est
    **abandonnée comme clé** : `enfant_id` est NULLable (les index uniques Postgres ne
    contraignent pas les NULL de la même façon) et un même foyer peut recevoir deux factures
    du même émetteur le même mois. La seule identité fiable est `facture_id` (upsert par id).
- `consumers/projection.service.ts` : ajouter `appliquerFactureEnregistree` (upsert par
  `factureId`) et `appliquerFactureSupprimee` (delete). Idempotence = patron existant :
  insert `processed_event` avec `onConflictDoNothing` dans la même transaction
  (`projection.service.ts:162-174`), PAS un simple « upsert par event_id » — calquer
  `appliquerEnfantAjoute` (l.281).
- **Abonnement** : les consommations se déclarent par STREAM + durable dans
  `ConsumerModule.forRoot` — le geste réel est d'ajouter
  `{ stream: 'FACTURATION', durable: 'tarification-facturation' }` à la constante `ABONNEMENTS`
  (`consumers/consumers.module.ts:7-11`), pas « s'abonner au sujet facturation.> ».
- **Spec d'intégration** : cas « plusieurs factures même foyer/mois/émetteur » + « suppression
  puis ré-émission », avec la base factice **durcie** qui honore PK + index uniques déclarés
  via `getTableConfig` (durcissement déjà fait dans
  `apps/svc-tarification/src/consumers/projection.integration.spec.ts` suite à #257 — le
  réutiliser ; piège : passer par les NOMS de colonnes, les types de `getTableConfig` et
  `getTableColumns` ne sont pas assignables entre eux).

### B2. Surface de lecture enrichie

- `tarification/cout.service.ts` :
  - étendre `CoutMoisVue` (l.151-158) avec `factureCentimes: number | null` +
    `lignesFacture: LigneVue[]` et `deltaCentimes: number | null` (calculé − facturé) ; idem
    `CoutAnnuelVue` (l.161-167). ⚠️ **Extension STRICTEMENT additive** : `CoutMoisVue` porte
    aussi `prestations[]` avec `grilleValideDu`/`contratValideDu` (plan 30, l.132-148) — ne
    rien casser, champs optionnels.
  - charger les factures du mois/année (nouvelle requête Drizzle), agréger par mois, joindre au
    coût calculé. Le « calculé » de référence = planning **réel** (`simule=false`).
  - rapprochement ligne à ligne : aligner par `nature`+`mode`. ⚠️ `LigneVue` actuelle =
    `{libelle, sens, montantCentimes}` SANS nature (l.125-129) → **ajouter `nature?` au mapping
    des lignes calculées** (création de la taxonomie côté calcul, symétrique de A1) — sinon
    repli sur libellé normalisé.
- `cout.controller.ts` : pas de nouvel endpoint nécessaire (les vues enrichies suffisent) ;
  `GET /api/couts/rapprochement?foyer&annee` optionnel v1.
- **Volet contrats & CI** : provider pact tarification re-vérifié (vues enrichies), generate-types.

### B3. Front — Coûts annuels & panneau mensuel

- `apps/web/src/api/client.ts` : types `CoutMoisVue`/`CoutAnnuelVue` étendus via
  `openapi-types.gen.ts` (régénérés, PAS édités) + `api.lireFactures(foyerId, annee)`.
- `couts/CoutsAnnuelsPage.tsx` : colonnes **« Facturé »** + **« Écart »**. ⚠️ `CelluleDelta`
  est un composant **local non exporté** de `CoutsAnnuelsPage.tsx:100` (utilisé l.471, 509) —
  à **exporter** (ou extraire dans `couts/CelluleDelta.tsx`) avant réutilisation ;
  `deltaEnEuros` et `repereDelta` sont bien dans `utils/money.ts:19,56`. Le tableau a déjà la
  structure multi-colonnes (simulé/réel/delta) → calquer.
- `couts/PanneauCoutMois.tsx` : montant facturé + détail ligne à ligne (calculé vs facturé par
  nature) sous le coût calculé.
- `couts/export.ts` : colonnes facturé/écart au CSV (les deltas y sont déjà gérés).
- **Mobile 375 px** : le tableau Coûts annuels vient de recevoir un traitement bottom-sheet au
  chantier confiance & quotidien — 2 colonnes de plus l'aggravent. Vérif 375 px explicite +
  intégration au bottom-sheet, pas juste un débordement horizontal.

---

## Phase C — Crédit d'impôt (côté lecture, base réelle)

### C1. Domaine `libs/tarification/domain/src/lib/credit-impot/`

⚠️ **Le patron « calquer grille-abcm.ts » du brouillon initial a DISPARU** : RM-30-04 (plan 30)
a retiré toute valeur tarifaire figée du domaine — `grille-abcm.ts` est devenu une façade
lecture seule `GrilleAbcm.depuisParametres(centimes)` alimentée par la projection du Référentiel
(`grille-abcm.ts:47-69`) ; les constantes par année ne survivent qu'en fixtures de test. Le
socle de versionnement réel est **`libs/shared-kernel/src/lib/versionnement.ts`** (convention
transversale, commune avec le plan 32 D3 : tout « versionné par année/date d'effet » passe par
`PeriodeValidite` + `selectionnerVersionApplicable` + `depuisSuite`/`depuisBornes`).

- `bareme-credit-impot.ts` — barème **constante domaine versionnée par année fiscale** (sous
  réserve H7 : un barème LÉGAL national n'est pas un tarif de structure — si le PO tranche
  « Référentiel seedé », ce fichier devient une façade `depuisParametres` comme `GrilleAbcm`) :
  suite de versions `{ periode: PeriodeValidite (année fiscale), taux: 0.5,
plafondParEnfantCentimes: 350000, anneeNaissanceMin }` construite via `depuisSuite`,
  résolution par `selectionnerVersionApplicable(versions, '<annee>-01-01')`.
- `eligibilite-credit-impot.ts` — règle pure :
  `estEligible(mode, nature, ageAu1erJanvier)` → éligible si `age < 6` ET
  `mode ∈ {CRECHE_PSU, PERISCOLAIRE, ALSH}` ET `nature ≠ repas`. `CANTINE` exclu. Lignes
  `credit` (déductions/aides) en moins de la base.
- `politique-credit-impot.ts` — `calculerCreditImpotEnfant({ lignesEligiblesPayeesCentimes,
aidesDeduitesCentimes, gardeAlternee, bareme })` → `base = max(0, payé − aides)` ;
  `baseRetenue = min(base, plafond × (gardeAlternee ? 0.5 : 1))` ;
  `credit = round(baseRetenue × taux)`. Retourne `{ baseRetenueCentimes, creditCentimes }`.
- spec vitest 100 % (cas : <6 vs ≥6, cantine exclue, repas exclu, plafond, garde alternée,
  aides, résolution de version — année couverte / non couverte → `AucuneVersionApplicableError`).

### C2. Calcul dans `svc-tarification`

- Ne retenir que les factures **payées** (`statut = 'payee'`), rattachées à l'année fiscale par
  la **`datePaiement`** (H5).
- Joindre `enfant.dateNaissance` (déjà projetée — `schema.ts:110`) → âge **au 1ᵉʳ janvier**.
- Pour chaque enfant : sommer les lignes **éligibles** (mode + nature + âge), déduire les aides,
  appliquer la politique. Flag **garde alternée** par enfant : lu depuis la projection foyer
  (persisté selon H4 — chemin d'écriture côté svc-foyer + projection, PAS un champ magique du
  read model), défaut non.
- Exposer via `CoutAnnuelVue.creditImpot` : `{ parEnfant: [{ enfantId, prenom,
baseRetenueCentimes, creditCentimes, eligible }], totalCreditCentimes }` (additif ;
  **préférer l'intégrer** à la vue annuelle plutôt qu'un endpoint dédié).

### C3. Front

- `couts/CoutsAnnuelsPage.tsx` : encart **« Crédit d'impôt estimé »** sous le tableau — total +
  détail par enfant (base retenue, crédit, mention « estimation, non opposable à
  l'administration »). Distinct de la future vue « après impôt » du plan 32 (H9).
- Inclure dans l'export CSV. Types via generate-types.

---

## Phase D — Front : saisie & gestion des factures

- `apps/web/src/factures/FacturesPage.tsx` — liste des factures du foyer (mois, émetteur,
  montant, statut, lien document), bouton « Ajouter une facture ».
- `factures/FactureFormModal.tsx` — chemin nominal v1 : formulaire structuré (émetteur, mois,
  enfant/mode, lignes nature+montant, aides, statut/date paiement, pièce jointe optionnelle) →
  `POST /v1/factures`. Réutiliser patterns `FoyerFormPage`/`ContratForm` (erreurs par champ,
  `messageErreur`), `Modale`, `ModaleConfirmation` (pour DELETE), `StatutSauvegarde`.
  **Si lot A4 activé** : étape 1 optionnelle « importer un fichier » → `POST /v1/factures/ocr`
  (multipart) → formulaire **pré-rempli** éditable → validation humaine → `POST /v1/factures`.
- `api/client.ts` : `api.creerFacture(dto)`, `api.lireFactures`, `api.supprimerFacture`,
  `api.mettreAJourFacture`, URL document (+ `api.ocrFacture(file, foyerId)` si A4).
- Route + entrée de navigation `/foyers/:id/factures` (calquer le routage `GardeFoyer` existant
  dans `App.tsx`). ⚠️ `App.tsx`/`styles.css` sont modifiés non commités (nav mobile) — rebaser
  sur l'état atterri (lot C0 consolidation d'abord).
- CSS : réutiliser `.carte` (styles.css:434), `.btn` (:334), `.modal`, variables existantes
  (repères sur la copie modifiée : re-vérifier).
- **A11y** : balayage axe e2e + `getComputedStyle` sur FacturesPage/FactureFormModal — les
  angles morts d'axe documentés (focus, contrastes de bordures de champs, `:disabled`,
  `opacity` d'ancêtre) frappent précisément les formulaires/modales.
- **Mobile 375 px** : liste + modale vérifiées à 375 px.

---

## Exploitation & topologie (avec A3 — aucun déploiement sans ce volet)

Renvoi : checklist canonique 32 lot 1 (items 3-10) adaptée `facturation`/3003. Points saillants
et spécifiques :

- `scripts/services.json` : `servicesApplicatifs` += `svc-facturation` (⚠️ source unique —
  `staging-poll.mjs` vérifie la cohérence compose↔services.json à chaque tick et **échoue
  explicitement** en cas de dérive) ET `providersPact` += `svc-facturation`.
- `docker-compose.yml` + `.staging` + `.server` : `postgres-facturation` (postgres:16-alpine,
  healthcheck `pg_isready`), `postgres-exporter-facturation`, volume `pg-facturation`, service
  `svc-facturation` (healthcheck liveness node A6, `mem_limit: 384m` + `cpus: 2`,
  `restart: unless-stopped`, `${PG_FACTURATION_PWD:?}`, `${ASSERTION_IDENTITE_SECRET:?}` +
  `INTERSERVICE_AUTHZ_ENFORCE`).
- `docker/prometheus.yml` (⚠️ pas `docker/prometheus/`) : cible blackbox
  `http://svc-facturation:3003/api/health/live` + cible `postgres-exporter-facturation:9187`
  label `base: facturation`.
- CI : liste en dur `smoke-stack` de `ci.yml` + constante `SERVICES` de `scripts/e2e-stack.mjs`
  (la matrix `build-images` est automatique) ; commentaires de topologie « N Postgres /
  N services » à rafraîchir.
- **Sauvegardes — CRITIQUE** : ajouter `postgres-facturation facturation facturation` au
  tableau `DATABASES` de `scripts/backup-all.sh:33-39` (liste en DUR, 5 entrées aujourd'hui) +
  vérifier `restore-one.sh`, `prune`, copie hors-site. Précédent exact : base notifications
  oubliée du même script (#258), sur fond d'incident « 0 backup prod depuis le 17/06 ».
  **Spécifique factures** : les `bytea` de justificatifs gonfleront les dumps nightly —
  chiffrer la volumétrie (H2 : taille max × volume attendu), re-mesurer le temps de
  backup/restore, prévoir la purge.
- Secrets sops+age : `PG_FACTURATION_PWD`, `DATABASE_URL` facturation, (+ `ANTHROPIC_API_KEY`
  si A4).
- Déploiement : train de release standard (`deploy.mjs`, poller de digest agrégé, rollback
  auto) ; cosign vérifie TOUTES les images déployées (Porte 1bis, `deploy.mjs:86,498`) —
  l'image `svc-facturation` est couverte dès qu'elle est dans services.json/compose.
- **Procédure de rejeu de projection** : si le schéma B1 évolue après un déploiement, un simple
  restart NE rejoue PAS les événements (leçon #257 : la ré-émission est gardée par un filtre,
  et `dead_letter` est en écriture seule, sans outil de rejeu). Documenter le rejeu (reset du
  durable `tarification-facturation` OU ré-émission côté source) AVANT d'en avoir besoin.

---

## Fichiers/patterns de référence à copier

| Besoin                                                                                        | Référence existante                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agrégat domaine + VO + erreurs + 100 % cov                                                    | `libs/foyer/domain/src/lib/{foyer,enfant,foyer-error}.ts`                                                                                                               |
| `Money`, `Tranche`, `DomainError`                                                             | `libs/shared-kernel/src/lib/*`                                                                                                                                          |
| **Versionnement par date d'effet (socle plan 30)**                                            | `libs/shared-kernel/src/lib/versionnement.ts` (`PeriodeValidite`, `selectionnerVersionApplicable`, `depuisSuite`)                                                       |
| Modes de contrat (source de vérité) + miroir domain                                           | `libs/contracts/kernel/src/lib/modes.ts` ; miroir : `libs/referentiel/domain/src/lib/mode-garde.ts`                                                                     |
| Contrat d'événement Zod + enveloppe                                                           | `libs/contracts/foyer/src/lib/events/foyer-events.ts`, `libs/contracts/kernel/src/lib/events/integration-event.ts`                                                      |
| **Checklist « nouveau service » bout-en-bout**                                                | `.claude/plans/travail-conges-revenus.md` § Lot 1 (canonique, corrigée 2026-07-30)                                                                                      |
| Service complet (main, modules mutualisés nest-commons, drizzle, outbox, nats, filter, trace) | `apps/svc-foyer/src/**` (+ `AssertionIdentiteModule` : `apps/svc-tarification/src/app.module.ts:41`)                                                                    |
| Schéma Drizzle + outbox                                                                       | `apps/svc-foyer/src/database/schema.ts`                                                                                                                                 |
| Politique tarifaire (port Stratégie) + `CoutMois`/`LigneDeCout`                               | `libs/tarification/domain/src/lib/{core,abcm,psu}/*` (⚠️ `GrilleAbcm` = façade `depuisParametres`, plus de constantes)                                                  |
| Read model, projection idempotente, agrégation annuelle, vues                                 | `apps/svc-tarification/src/{database/schema.ts,consumers/projection.service.ts,consumers/consumers.module.ts,tarification/cout.service.ts,tarification/cout.mapper.ts}` |
| Base factice honorant PK + index uniques (leçon #257)                                         | `apps/svc-tarification/src/consumers/projection.integration.spec.ts` (durcissement `getTableConfig`)                                                                    |
| Client résilient + route BFF + relais + validation + scope                                    | `apps/api-gateway/src/{clients/appel-resilient.ts,clients/referentiel.client.ts,bff/couts.controller.ts,bff/relais.ts,bff/bff.dto.ts,security/foyer-scope.ts}`          |
| Pacts consumer/provider                                                                       | `apps/api-gateway/src/contract/*.consumer.pact.spec.ts`, `apps/svc-tarification/src/contract/tarification.provider.pact.spec.ts`                                        |
| Page coûts + delta + hook async + client + export CSV                                         | `apps/web/src/{couts/CoutsAnnuelsPage.tsx (CelluleDelta l.100 à exporter),couts/PanneauCoutMois.tsx,couts/export.ts,hooks/useAsync.ts,api/client.ts,utils/money.ts}`    |
| Formulaires + modales + statut                                                                | `apps/web/src/{foyer/FoyerFormPage.tsx,foyer/ContratForm.tsx,ui/Modale.tsx,ui/ModaleConfirmation.tsx,ui/StatutSauvegarde.tsx}`                                          |
| E2E stack (modèle récent + spec à étendre)                                                    | `apps/web/e2e/avenant-contrat.stack.e2e.spec.ts` (plan 30), `apps/web/e2e/couts.stack.e2e.spec.ts`                                                                      |

## Nouveaux éléments (n'existent pas dans le repo)

- Usage de `FileInterceptor` + `@types/multer` + relais multipart binaire gateway
  (`@nestjs/platform-express` et l'override `multer ^2.2.0` sont déjà là — cf. A3).
- Appel API Anthropic / OCR vision — nouveau, conditionné H1 (`output_config.format`,
  stub `OCR_FACTURE_STUB`).
- Stockage binaire (`bytea`) du justificatif + son impact sauvegardes.
- Taxonomie `nature` des lignes (des DEUX côtés : facture ET lignes calculées).
- Événement de suppression propagé à un read model aval (`FactureSupprimee`).
- Génération de scaffolding Nx via la skill `nx-generate` (lib domain, lib contracts, app service).

## Décisions actées

- Rapprochement **ligne par ligne** (nature × mode) — taxonomie créée des deux côtés.
- **Archivage** du document d'origine (bytea, taille plafonnée H2).
- Crédit d'impôt sur **montants payés** (`statut = 'payee'`), barème **versionné par année
  fiscale via `versionnement.ts`** (support : constante domaine vs Référentiel = H7).
- Surfaces lecture **dans `svc-tarification`** (réutilise dateNaissance + agrégation annuelle).
- Crédit d'impôt et facturé **intégrés à la vue Coûts annuels** (pas d'écran séparé) ; écran
  dédié uniquement pour la saisie/gestion des factures.
- **Saisie manuelle = chemin nominal v1** ; OCR = lot optionnel conditionné (H1).
- **PK surrogate systématique** sur les nouvelles tables (facture ET projection) — leçon #257.
- **`FactureSupprimee` obligatoire** dès la v1 (pas de DELETE sans événement).
- **Dédup serveur** sur POST /factures (empreinte SHA-256 → 409).
- **`@FoyerScope` sur toutes les routes** + `AssertionIdentiteModule` dès le premier commit.
- Port **3003** + stream **`FACTURATION`** (réservation croisée avec le plan 32).

---

## Vérification (end-to-end, critères falsifiables)

1. **Domaine** : `corepack pnpm@10.34.2 nx test facturation-domain` et `nx test
tarification-domain` (100 % couverture ; crédit d'impôt : <6/≥6, cantine/repas exclus,
   plafond, garde alternée, versions de barème) — le type-check et les builds de libs
   viennent avec la cible `test`, cf. [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md).
   **Build/lint des projets affectés** : `corepack pnpm@10.34.2 nx affected -t build lint`.
2. **Contrats** : `nx test contracts-facturation` (payloads valides/invalides,
   FactureEnregistree ET FactureSupprimee).
3. **Contrats & CI transverses** : oracle OpenAPI vert (`gateway.openapi.spec.ts`, 27→N routes
   assumé), `nx run web:generate-types` sans drift, pacts consumer+provider verts,
   `pact-can-i-deploy` vert avec `services.json` à jour, gate de couverture non dégradée.
4. **Services** : stack complète (`docker compose up --wait` incluant svc-facturation +
   postgres-facturation — smoke-stack et e2e-stack listes complétées) ;
   - `POST /api/v1/factures` (saisie) → persistance + événement publié + projection visible
     dans le read model tarification ; rejouer le MÊME POST → **409** (dédup) ;
   - `DELETE /api/v1/factures/:id` → la facture disparaît de `GET /api/v1/couts/annuel` ;
   - `GET /api/v1/couts/annuel?foyer&annee` → colonnes facturé/écart + bloc crédit d'impôt ;
   - `GET /api/v1/factures/:id/document` → justificatif archivé restitué ;
   - requête sans assertion → log « ASSERTION AURAIT REFUSÉ » (observe) ; requête d'un foyer
     étranger → 403 ;
   - (si A4) `POST /api/v1/factures/ocr` avec `OCR_FACTURE_STUB=1` → brouillon déterministe
     (plomberie) ; ET, **hors CI**, avec un **PDF de facture réel** → brouillon extrait
     plausible (critère d'acceptation manuel du lot A4, cf. A4).
5. **Front (preview\_\*)** : `/foyers/:id/factures` → saisir une facture, la voir en liste ;
   `/foyers/:id/couts` → colonnes « Facturé »/« Écart » + encart crédit d'impôt ; export CSV.
   **375 px** : tableau Coûts annuels (bottom-sheet) + modale facture. Balayage axe +
   `getComputedStyle` (focus, bordures, `:disabled`) sur les nouveaux écrans. Preuve
   (screenshot/logs réseau).
6. **E2E stack** : nouveau `apps/web/e2e/factures.stack.e2e.spec.ts` (parcours saisie →
   projection → coûts, stub OCR si A4) + **extension de `couts.stack.e2e.spec.ts`** (colonnes
   Facturé/Écart + encart crédit d'impôt). Pièges connus : dates fixes → conflits au retry CI
   (leçon #254), flaky seed 503 corrigé par #255.
7. **Exploitation** : `backup-all.sh` dumpe la base facturation, `restore-one.sh` la restaure ;
   `staging-poll` (dry) sans dérive compose↔services.json ; cible Prometheus UP.

## Séquencement de livraison conseillé

**Lot 0 (cadrage PO, H1-H9)** → **A1-A3 + A5** (socle écriture, saisie manuelle) → **B**
(projection + rapprochement) → **C** (crédit d'impôt ; dépend de B1, pas de B2/B3) → **D**
(front saisie/gestion) → **A4 + volet OCR de D** (lot optionnel, si H1 validée — seul lot
dépendant d'un service externe). A1-A3+A5+B+C+D forment un **incrément complet sans dépendance
externe**. Chaque phase est mergeable indépendamment (pattern d'orchestration par phases du
repo) ; chaque phase exposant une route embarque son volet « contrats & CI ». Prérequis
d'ouverture du chantier : train de release n°16 passé (lot R1 consolidation), lot C0 (nav
mobile) atterri avant B3/C3/D, et checklist 32 lot 1 disponible comme référence exécutée.
