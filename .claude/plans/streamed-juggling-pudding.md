# Plan — Factures réelles : rapprochement budgétaire & crédit d'impôt

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

Saisie via **import PDF/photo (OCR)** avec **validation humaine obligatoire** avant enregistrement.
Le **document original est archivé** (justificatif). Rapprochement **ligne par ligne**.

> ⚠️ Vocabulaire : l'axe existant `simule` oppose _planning réel_ vs _planning hypothétique_, tous
> deux valorisés par le modèle. La facture est un **axe distinct** (montant facturé = vérité terrain).
> On ne réutilise PAS le flag `simule` pour les factures.

### Règles fiscales retenues (crédit d'impôt frais de garde — à versionner par année)

Sources : [service-public.gouv.fr/F8](https://www.service-public.gouv.fr/particuliers/vosdroits/F8),
[impots.gouv.fr](https://www.impots.gouv.fr/particulier/questions/je-fais-garder-mon-jeune-enfant-lexterieur-du-domicile-que-puis-je-deduire).

- **50 %** des dépenses de garde, **plafond 3 500 €/enfant/an** → crédit max **1 750 €/enfant**
  (revenus 2025, déclaration 2026). **Moitié** (1 750 € plafond, 875 € crédit) en garde alternée.
- Enfant **< 6 ans au 1ᵉʳ janvier de l'année des revenus** (né à partir du 01/01/2019 pour 2025).
- **Éligibles** : crèche (`CRECHE_PSU`), **périscolaire** (`PERISCOLAIRE`), **ALSH** (`ALSH`),
  assistant·e maternel·le.
- **Non éligibles** : **cantine** (`CANTINE`, dépense courante) et **toute ligne de nature repas/
  nourriture** (à exclure même sur une facture par ailleurs éligible).
- À **déduire** : aides CAF (CMG) et aides employeur (champ de saisie prévu, défaut 0).

---

## Architecture (CQRS conforme à l'existant)

- **Écriture** → nouveau service `svc-facturation` : upload + OCR + validation + persistance +
  archivage du document + émission d'événement `FactureEnregistree`.
- **Lecture/calcul** → on étend `svc-tarification` (déjà détenteur de `enfant.dateNaissance`, de
  l'agrégation annuelle et de la surface `CoutAnnuelVue`) : il projette les factures dans son read
  model, puis calcule le **rapprochement** et le **crédit d'impôt**.
- **BFF** → `api-gateway` relaie : upload multipart vers `svc-facturation`, lectures vers
  `svc-tarification`.
- **Front** → `apps/web` : écran d'import+validation OCR, liste des factures, colonne « Facturé » +
  delta sur Coûts annuels, encart crédit d'impôt.

Patterns de référence à copier à l'identique (voir chemins en fin de doc).

---

## Phase A — Socle facturation (côté écriture)

### A1. Domaine `libs/facturation/domain` (vitest 100 %)

Calquer `libs/foyer/domain` (constructeur privé + `static creer()` + invariants → `DomainError`,
immuabilité, `Money` en centimes).

- `lib/nature-ligne-facture.ts` — type `NatureLigneFacture` :
  `'base' | 'complement' | 'deduction' | 'seance' | 'repas' | 'frais' | 'autre'`
  (aligné sur les natures de `LigneDeCout`). + helper `estNatureRepas(nature)`.
- `lib/ligne-facture.ts` — VO `LigneFacture { libelle, montant: Money, nature, sens: 'debit'|'credit' }`.
- `lib/facture.ts` — agrégat `FactureReelle` :
  - champs : `foyerId`, `enfantId?`, `contratId?`, `mode?: ModeGarde`, `emetteur: string`,
    `mois: string (YYYY-MM)`, `lignes: readonly LigneFacture[]`, `aidesDeduitesCentimes`,
    `statut: 'a_payer' | 'payee'`, `datePaiement?: string`.
  - dérivé : `total: Money` (Σ débits − Σ crédits, comme `CoutMois.total`).
  - invariants : `mois` au format `YYYY-MM`, au moins une ligne, montants ≥ 0, `datePaiement`
    requise si `statut = 'payee'`.
- `lib/facturation-error.ts` — erreurs `MoisInvalideError`, `FactureVideError`, etc. (héritent
  `DomainError`).
- `src/index.ts` — exports publics.
- `package.json` — tags `type:domain,context:facturation`, dépend de `shared-kernel` +
  `tarification-domain` (pour `ModeGarde`) ou redéclarer le type localement pour éviter le couplage
  (préférer **redéclarer** `ModeGarde` côté contrat partagé si déjà ailleurs ; sinon importer).

### A2. Contrats d'événements `libs/contracts/facturation`

Calquer `libs/contracts/foyer`. Événement **`facturation.FactureEnregistree.v1`** (Zod +
`integrationEventSchema`). Payload : `factureId`, `foyerId`, `enfantId?`, `contratId?`, `mode?`,
`emetteur`, `mois`, `lignes[]` (libelle, montantCentimes, nature, sens), `aidesDeduitesCentimes`,
`statut`, `datePaiement?`. Constante `FACTURATION_EVENT_SOURCE = 'svc-facturation'`. + spec de
validation (payload bien/mal formé).

### A3. Service `apps/svc-facturation`

Calquer `apps/svc-foyer` **intégralement** (main.ts, app.module, config, tracing, DomainExceptionFilter,
DatabaseModule, NatsModule + stream `FACTURATION`, OutboxModule + relay, HealthModule).

- `database/schema.ts` :
  - table `facture` (centimes en `bigint`, `mois varchar(7)`, `statut`, `date_paiement date null`,
    `emetteur`, `foyer_id`, `enfant_id null`, `contrat_id null`, `mode varchar(32) null`,
    `aides_deduites_centimes bigint default 0`, timestamps).
  - table `facture_ligne` (FK `facture_id` cascade, `libelle`, `montant_centimes bigint`, `nature`,
    `sens`). _(ou `lignes jsonb` sur `facture` — préférer table dédiée pour requêtage ligne à ligne.)_
  - table `facture_document` (FK `facture_id`, `contenu bytea`, `type_mime`, `nom_fichier`,
    `taille`) — **archivage du PDF/photo**.
  - table `outbox` (identique à svc-foyer).
- `facturation/facture.dto.ts` — schémas Zod : `confirmerFactureSchema` (résultat OCR validé par
  l'utilisateur), filtres de liste. `ZodValidationPipe` repris tel quel.
- `facturation/facture.controller.ts` :
  - `POST /api/factures/ocr` — **multipart** (PDF/photo) → renvoie un **brouillon** extrait
    (non persisté) : `{ emetteur?, mois?, lignes[], total }`. Voir A4.
  - `POST /api/factures` — corps = brouillon **validé** + référence au document → persiste
    (`FactureReelle.creer`), archive le document, insère l'événement outbox **dans la même
    transaction**, renvoie la vue.
  - `GET /api/factures?foyer=UUID&annee=YYYY` — liste.
  - `GET /api/factures/:id` / `GET /api/factures/:id/document` (flux du bytea) / `DELETE`.
  - `PUT /api/factures/:id` (corriger / marquer payée).
- `facturation/facture.service.ts` — conversions DTO(euros)→domaine(Money)→BD(centimes),
  transactions Drizzle + outbox, vues HTTP. Émettre `FactureEnregistree` à chaque create/update.
- Upload multipart NestJS : ajouter dépendance d'upload (FileInterceptor `@nestjs/platform-express` +
  `multer`) — **nouveau** dans le repo, à introduire ici.

### A4. OCR via API Anthropic (Claude vision)

- `facturation/ocr/ocr.service.ts` — appelle l'**API Messages Anthropic** avec le document
  (bloc `document` PDF ou `image`) + **tool use** (sortie structurée forcée) renvoyant
  `{ emetteur, mois (YYYY-MM), lignes:[{libelle, montant, nature, sens}], total, confiance }`.
  Activer le **prompt caching** sur l'instruction système (cf. skill `claude-api`).
  Clé API via `config.ts` (`ANTHROPIC_API_KEY`), modèle par défaut `claude-opus-4-8` (ou
  `claude-sonnet-4-6` pour le coût). Le service **classe** chaque ligne dans une `NatureLigneFacture`
  et propose `mode`/`emetteur` ; l'utilisateur corrige à l'écran (A4 n'a pas autorité, la validation
  humaine fait foi).
- Résilience : si l'OCR échoue/incertain, renvoyer un brouillon vide → saisie manuelle des lignes.

### A5. BFF `apps/api-gateway`

- `clients/facturation.client.ts` — calquer `tarification.client.ts` (timeout/retry/circuit-breaker
  via `executerResilient`). Méthodes : `ocr(fichier)`, `creer(dto)`, `lister(foyer, annee)`,
  `obtenir(id)`, `document(id)`, `supprimer(id)`, `mettreAJour(id, dto)`.
- `bff/factures.controller.ts` — `@Controller({ path: 'factures', version: '1' })`, validations Zod
  (`moisSchema`, foyer requis), `relayer(...)`. Route multipart `POST /api/v1/factures/ocr`
  (FileInterceptor, relais du flux binaire vers svc-facturation).
- `config.ts` — ajouter `facturationUrl`.

---

## Phase B — Rapprochement calculé vs facturé (côté lecture, `svc-tarification`)

### B1. Projection des factures dans le read model

- `database/schema.ts` (svc-tarification) : nouvelles tables `facture_reelle` + `facture_reelle_ligne`
  (projection de l'événement). Clé : `(foyer_id, mois, enfant_id, emetteur)`.
- `consumers/projection.service.ts` : ajouter `appliquerFactureEnregistree` (sur le stream
  `FACTURATION`) — upsert idempotent par `event_id`, comme les projections existantes
  (`appliquerEnfantAjoute`, etc.). Abonner le consumer au sujet `facturation.>`.

### B2. Surface de lecture enrichie

- `tarification/cout.service.ts` :
  - étendre `CoutMoisVue` avec `factureCentimes: number | null` + `lignesFacture: LigneVue[]`
    et `deltaCentimes: number | null` (calculé − facturé) ; idem agrégat annuel dans `CoutAnnuelVue`.
  - charger les factures du mois/année (nouvelle requête Drizzle), les agréger par mois, et joindre
    au coût calculé. Le « calculé » de référence = planning **réel** (`simule=false`).
  - le rapprochement ligne à ligne : aligner par `nature`+`mode` (le calculé a déjà
    `LigneVue{libelle, sens, montantCentimes}` ; ajouter `nature` au mapping des lignes calculées
    pour permettre l'alignement — sinon aligner par libellé normalisé).
- `cout.controller.ts` : pas de nouvel endpoint nécessaire (les vues enrichies suffisent), mais
  ajouter `GET /api/couts/rapprochement?foyer&annee` si on veut une vue dédiée (optionnel v1).

### B3. Front — Coûts annuels & panneau mensuel

- `apps/web/src/api/client.ts` : types `CoutMoisVue`/`CoutAnnuelVue` étendus (champs facture/delta),
  - `api.lireFactures(foyerId, annee)`.
- `couts/CoutsAnnuelsPage.tsx` : ajouter colonnes **« Facturé »** + **« Écart »** (réutiliser
  `CelluleDelta`, `repereDelta`, `deltaEnEuros` de `utils/money.ts`). Le tableau a déjà la structure
  multi-colonnes (simulé/réel/delta) → calquer.
- `couts/PanneauCoutMois.tsx` : afficher le montant facturé + détail ligne à ligne (calculé vs
  facturé par nature) sous le coût calculé.
- `couts/export.ts` : ajouter colonnes facturé/écart au CSV.

---

## Phase C — Crédit d'impôt (côté lecture, base réelle)

### C1. Domaine `libs/tarification/domain/src/lib/credit-impot/`

- `bareme-credit-impot.ts` — **barème versionné par année fiscale** (calquer `grille-abcm.ts`) :
  `{ taux: 0.5, plafondParEnfantCentimes: 350000, anneeMin: 2019 }` pour 2025/2026 ;
  `BAREME_CREDIT_IMPOT[annee]` + `static pour(annee)`.
- `eligibilite-credit-impot.ts` — règle pure :
  `estEligible(mode, nature, ageAu1erJanvier)` →
  éligible si `age < 6` ET `mode ∈ {CRECHE_PSU, PERISCOLAIRE, ALSH}` ET `nature ≠ repas`.
  `CANTINE` exclu. Lignes `credit` (déductions/aides) traitées en moins de la base.
- `politique-credit-impot.ts` — `calculerCreditImpotEnfant({ lignesEligiblesPayeesCentimes,
aidesDeduitesCentimes, gardeAlternee, bareme })` →
  `base = max(0, payé − aides)` ; `baseRetenue = min(base, plafond × (gardeAlternee ? 0.5 : 1))` ;
  `credit = round(baseRetenue × taux)`. Retourne `{ baseRetenueCentimes, creditCentimes }`.
- spec vitest 100 % (cas : <6 vs ≥6, cantine exclue, repas exclu, plafond, garde alternée, aides).

### C2. Calcul dans `svc-tarification`

- Ne retenir que les factures **payées** (`statut = 'payee'`), de l'année fiscale.
- Joindre `enfant.dateNaissance` (déjà projetée) → calculer l'âge **au 1ᵉʳ janvier de l'année**.
- Pour chaque enfant : sommer les lignes **éligibles** (mode + nature + âge), déduire les aides,
  appliquer la politique. Champ « garde alternée » par enfant (saisie, défaut non).
- Exposer via `CoutAnnuelVue.creditImpot` : `{ parEnfant: [{ enfantId, prenom, baseRetenueCentimes,
creditCentimes, eligible }], totalCreditCentimes }`. (Alternative : endpoint
  `GET /api/couts/credit-impot?foyer&annee` ; **préférer l'intégrer** à la vue annuelle.)

### C3. Front

- `couts/CoutsAnnuelsPage.tsx` : encart **« Crédit d'impôt estimé »** sous le tableau — total +
  détail par enfant (base retenue, crédit, mention « estimation, non opposable à l'administration »).
- inclure dans l'export CSV.

---

## Phase D — Front : import & gestion des factures

- `apps/web/src/factures/FacturesPage.tsx` — liste des factures du foyer (mois, émetteur, montant,
  statut, lien document), bouton « Importer une facture ».
- `factures/ImportFactureModal.tsx` — flux :
  1. champ fichier (PDF/photo) → `POST /v1/factures/ocr` (multipart) → brouillon.
  2. formulaire **pré-rempli** éditable (émetteur, mois, enfant/mode, lignes nature+montant, aides,
     statut/date paiement) → validation utilisateur. Réutiliser patterns `FoyerFormPage`/`ContratForm`
     (erreurs par champ, `messageErreur`), `Modale`, `StatutSauvegarde`.
  3. `POST /v1/factures` → enregistre + archive document.
- `api/client.ts` : `api.ocrFacture(file)`, `api.creerFacture(dto)`, `api.lireFactures`,
  `api.supprimerFacture`, URL document.
- Route + entrée de navigation `/foyers/:id/factures` (calquer le routage existant `GardeFoyer`).
- CSS : réutiliser `.carte`, `.btn`, `.modal`, variables de `styles.css`.

---

## Fichiers/patterns de référence à copier

| Besoin                                                                | Référence existante                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Agrégat domaine + VO + erreurs + 100 % cov                            | `libs/foyer/domain/src/lib/{foyer,enfant,foyer-error}.ts`                                                                            |
| `Money`, `Tranche`, `DomainError`                                     | `libs/shared-kernel/src/lib/*`                                                                                                       |
| Contrat d'événement Zod + enveloppe                                   | `libs/contracts/foyer/src/lib/events/foyer-events.ts`, `libs/contracts/kernel/.../integration-event.ts`                              |
| Service complet (main, modules, drizzle, outbox, nats, filter, trace) | `apps/svc-foyer/src/**`                                                                                                              |
| Schéma Drizzle + outbox                                               | `apps/svc-foyer/src/database/schema.ts`                                                                                              |
| Politique + barème versionné + `CoutMois`/`LigneDeCout`               | `libs/tarification/domain/src/lib/{core,abcm,psu}/*`                                                                                 |
| Read model, projection, agrégation annuelle, vues                     | `apps/svc-tarification/src/{database/schema.ts,consumers/projection.service.ts,tarification/cout.service.ts,cout.mapper.ts}`         |
| Client résilient + route BFF + relais + validation                    | `apps/api-gateway/src/{clients/tarification.client.ts,bff/couts.controller.ts,bff/relais.ts,bff/bff.dto.ts}`                         |
| Page coûts + delta + hook async + client + export CSV                 | `apps/web/src/{couts/CoutsAnnuelsPage.tsx,couts/PanneauCoutMois.tsx,couts/export.ts,hooks/useAsync.ts,api/client.ts,utils/money.ts}` |
| Formulaires + modales + statut                                        | `apps/web/src/{foyer/FoyerFormPage.tsx,foyer/ContratForm.tsx,ui/Modale.tsx,ui/ModaleConfirmation.tsx,ui/StatutSauvegarde.tsx}`       |

## Nouveaux éléments (n'existent pas dans le repo)

- Upload multipart (`@nestjs/platform-express`/`multer`) — introduit dans svc-facturation + gateway.
- Appel API Anthropic / OCR vision — nouveau (skill `claude-api`, prompt caching, tool use).
- Stockage binaire (`bytea`) du justificatif.
- Génération de scaffolding Nx via la skill `nx-generate` (lib domain, lib contracts, app service).

## Décisions actées

- Rapprochement **ligne par ligne** (nature × mode).
- **Archivage** du document d'origine (bytea).
- Crédit d'impôt sur **montants payés** (`statut = 'payee'`), barème **versionné par année**.
- Surfaces lecture **dans `svc-tarification`** (réutilise dateNaissance + agrégation annuelle).
- Crédit d'impôt et facturé **intégrés à la vue Coûts annuels** (pas d'écran séparé) ; écran dédié
  uniquement pour l'import/gestion des factures.

---

## Vérification (end-to-end)

1. **Domaine** : `pnpm nx test facturation-domain` et `pnpm nx test tarification-domain`
   (100 % couverture ; cas crédit d'impôt : <6/≥6, cantine/repas exclus, plafond, garde alternée).
2. **Contrats** : `pnpm nx test contracts-facturation` (payload valide/invalide).
3. **Build/lint affectés** : `pnpm nx affected -t build lint`.
4. **Services** : démarrer la stack (svc-facturation, svc-tarification, api-gateway, NATS, PG) ;
   - `POST /api/v1/factures/ocr` avec un PDF de facture réel → vérifier le brouillon extrait.
   - `POST /api/v1/factures` (brouillon validé) → vérifier persistance + événement publié + projection
     dans le read model de tarification.
   - `GET /api/v1/couts/annuel?foyer&annee` → vérifier colonnes facturé/écart + bloc crédit d'impôt.
   - `GET /api/v1/factures/:id/document` → récupérer le justificatif archivé.
5. **Front (preview\_\*)** : page `/foyers/:id/factures` → importer une facture (OCR), valider, voir la
   liste ; page `/foyers/:id/couts` → vérifier colonne « Facturé », « Écart » et l'encart crédit
   d'impôt ; export CSV. Capturer une preuve (screenshot/logs réseau).
6. **E2E** : étendre la suite Phase 15 (stack réelle) si présente, avec un parcours facture complet.

## Séquencement de livraison conseillé

A (socle écriture + OCR) → B (rapprochement) → C (crédit d'impôt) → D (front import).
A est prérequis de B/C/D. B et C partagent la projection (B1) ; C dépend de B1 mais pas de B2/B3.
Chaque phase est mergeable indépendamment (suivre le pattern d'orchestration par phases du repo).
