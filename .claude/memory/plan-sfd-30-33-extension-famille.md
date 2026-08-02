---
name: plan-sfd-30-33-extension-famille
description: "4 SFD brouillons (docs 30→33) — versionnement dates d'effet, vacances scolaires, travail/CP/revenus parents, planning famille — décisions PO 2026-07-19 + audit abstractions P1→P6"
metadata:
  node_type: memory
  type: project
  originSessionId: 681809a6-1370-46c1-9d4b-64eacb59355e
  modified: 2026-07-31T19:48:08.949Z
---

**Chantier exploration 2026-07-19** : 4 SFD rédigées dans `docs/` (non committées à la création), numérotation globale → 30/31/32/33 (28/29 pris par `exploitation/`). Priorité validée PO : **fondations d'abord** (30 → 31 → 32 → 33).

- `docs/30-sfd-versionnement-dates-effet.md` — entités versionnées [dateEffet, fin), passé immuable, correction rétroactive explicite. Périmètre : contrats de garde + grilles/barèmes + contrats travail + foyer (tout validé PO). Intègre la dette DV-01→04 issue de l'audit abstractions.
- `docs/31-sfd-calendriers-vacances-scolaires.md` — calendrier d'ouverture par établissement (3 couches : exceptions > périodes > récurrence hebdo), import open data Éducation nationale zone paramétrable (zone B cas réel) + retouches manuelles préservées.
- `docs/32-sfd-travail-conges-revenus.md` — Employeur/ContratTravail versionné/RégimeCongés/RégimeAbsences paramétrés (jamais de convention en dur). Cas réels : Edouard = Onepoint CDI Syntec ETAM 3.1, 35h sans RTT, télétravail quasi complet, CP N-1/N ; Anna = Sulzer Allschwil 40% 16h/sem CHF 2700 + 13e salaire nov., frontalière, 25 j vacances prorata (décompte en heures : 80 h/an), compteur heures sup +/-. Solde CP = moteur + recalage fiche de paie. Revenus : montant EUR réellement reçu (CHF) + taux référence pour projections ; 2 vues impôt (avant + estimation taux moyen paramétrable). Absences typées à effet compteurs+revenus (CP, sans solde, rattrapage, maladie justifiée/non).
- `docs/33-sfd-planning-famille.md` — abstraction Membre/Engagement (source dérivée vs saisie), trajets dépose/récup affectés, événements libres multi-participants, catalogue de conflits CF-01→06, acquittement avec motif, RM-33-03 paramètre « télétravail = disponible ».

**Audit abstractions 2026-07-19** (confirme intuition PO « objets réels en dur ») : établissements = déjà bien abstraits (chantier entité libre) ; vrais points durs = P1 `GRILLE_ABCM_2026` et P2 `BAREME_EFFORT_PSU_2026` en constantes domaine alors que le Référentiel versionné (`grille_tarifaire`) existe mais est **contourné au runtime** (read-model décoratif, cf. `cout.mapper.ts:174`, `referentiel.client.ts:31-38`) ; P3 seuils tranches 20k/50k en dur shared-kernel ; P4 enum `ModeGarde` fermé divergent entre libs ; P5 famille ABCM redéfinie en triple ; P6 dichotomie PSU/ABCM en dur. Résorption intégrée à la SFD 30 (DV-01→04).

**Plans d'implémentation rédigés (2026-07-19, brouillons à valider PO)** dans `.claude/plans/` : `versionnement-dates-effet.md` (7 lots — socle shared-kernel, GrillePubliee.v2 avec montants, BaremePsuPublie/BaremeTranchesPublie, contrat_version + suppression du PUT destructif, foyer_version, UI, consolidation modes), `calendriers-vacances-scolaires.md` (5 lots — calendrier 3 couches possédé par svc-planification, import ODS data.education.gouv, fériés calculés avec régime Alsace-Moselle, remplacement de jour_non_facturable avec test différentiel au centime), `travail-conges-revenus.md` (5 lots — **nouveau service unique `svc-famille` port 3007 stream FAMILLE partagé avec la SFD 33**, MontantDevise dans shared-kernel, régimes = données seedées, moteur congés pur recalé sur bulletins), `planning-famille.md` (5 lots — module planning de svc-famille, conflits évalués à la lecture avec acquittement par clé déterministe, notification hebdo qui absorbe l'alerte vacances du plan 31 lot 5). Chaque plan répond aux Q-3x par des hypothèses H1-H8 explicites à faire valider.

**Révision complète des plans 2026-07-30/31** (workflow multi-agents : audit ancrages + croisement inter-plans + réécriture + QC) — les 3 plans 31/32/33 et `factures-reelles.md` (ex `streamed-juggling-pudding.md`, renommé) sont ré-ancrés sur le code réel post-plan-30 (main `9aee291`). Décisions inter-plans consignées DANS les fichiers :

- **Ordre d'exécution : consolidation (R1 train n°16 + C0 + B2 + C5) → 31 → 32 → 33 → factures** ; exécution séquentielle obligatoire sur les surfaces partagées (`gateway.openapi.ts` + oracle « 27 routes », types générés, pacts, `services.json`, `TYPES_NOTIFICATION`).
- **Lot 5 du plan 31 (alerte vacances) RETIRÉ** — absorbé par le plan 33 lot 5 (`CONFLITS_FAMILLE`/CF-03) ; retirer un type de `TYPES_NOTIFICATION` ≠ revert simple (5-6 points de contact : foyer-events, bff.dto, preferences.util, MonProfilPage, OpenAPI/types).
- **`joursFeries(annee, regime)` hissé en shared-kernel** (pas planification-domain : depConstraints Nx interdisent l'import depuis famille-domain) ; régimes FR/FR_ALSACE_MOSELLE, CH_BL ajouté par le 32.
- **Plan 33 GELÉ** tant que 31 lots 1-3 et 32 lots 1-3 pas mergés ; son read-model `contrat_garde` refondu PAR VERSION (leçon #257, PK surrogate).
- **32 lot 1 = checklist canonique « nouveau service » (12 items)**, réutilisée par factures ; réservation croisée ports/streams : svc-famille 3007/FAMILLE, svc-facturation 3003/FACTURATION.
- **Factures réelles** : lot 0 PO bloquant (H1-H9 : OCR/PII, stockage justificatifs, EUR-only, garde alternée→svc-foyer, barème crédit d'impôt versionné via shared-kernel `versionnement.ts`) ; en DERNIER, au plus tôt après 32 lot 1 ; homonymie fiscale à clarifier PO (crédit d'impôt garde ≠ vue après-impôt du 32 lot 5).

Reste : validation PO des SFD **et** des hypothèses des plans (notamment : service unique svc-famille, DV-04 réduit à la consolidation, calendrier non versionné-30 en v1, D6/D7 du 31 ajoutés à la révision). Lié : [[plan-fondations-backend]], [[feature-qualite-couts]], [[plan-consolidation-ui-qualite]].
