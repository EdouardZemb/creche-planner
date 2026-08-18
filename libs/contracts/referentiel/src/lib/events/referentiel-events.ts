import { z } from 'zod';
import {
  integrationEventSchema,
  MODES_ABCM,
} from '@creche-planner/contracts-kernel';

/**
 * Événements d'intégration du bounded context **Référentiel** (catalogue tarifaire
 * versionné, doc 06 §9). Émis par `svc-referentiel` via l'outbox, publiés sur NATS
 * JetStream (stream `REFERENTIEL`, sujets `referentiel.>`). Les consommateurs
 * (Phase 6, `svc-tarification`) y apprennent qu'une nouvelle grille est applicable.
 */

/** Service émetteur (champ `source` de l'enveloppe). */
export const REFERENTIEL_EVENT_SOURCE = 'svc-referentiel';

/**
 * Modes facturés via une grille ABCM — ré-export de compatibilité de la
 * définition unique (SFD 30 §H4, `@creche-planner/contracts-kernel`).
 */
export const MODES_ABCM_CONTRAT = MODES_ABCM;

// --- referentiel.GrillePubliee.v1 -------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const GRILLE_PUBLIEE_TYPE = 'referentiel.GrillePubliee.v1';

export const grillePublieePayloadSchema = z.object({
  grilleId: z.string().uuid(),
  /** Mode de garde couvert par la grille (ABCM par tranche). */
  mode: z.enum(MODES_ABCM_CONTRAT),
  /** Tranche RFR ABCM concernée (1/2/3). */
  tranche: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Début de validité, ISO `YYYY-MM-DD`. */
  valideDu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  /** Fin de validité, ISO `YYYY-MM-DD`, ou `null` si période ouverte. */
  valideAu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .nullable(),
});
export type GrillePublieePayload = z.infer<typeof grillePublieePayloadSchema>;

export const grillePublieeEventSchema = integrationEventSchema(
  grillePublieePayloadSchema,
);
export type GrillePublieeEvent = z.infer<typeof grillePublieeEventSchema>;

// --- referentiel.GrillePubliee.v2 -------------------------------------------

/**
 * Nom métier versionné (champ `type` de l'enveloppe). La v2 est **additive**
 * (SFD 30, D1) : elle transporte, en plus du repère v1, les **paramètres
 * tarifaires complets** (montants en centimes) du mode projeté, si bien que le
 * consommateur `svc-tarification` n'a plus besoin d'aucune valeur figée pour
 * chiffrer (RM-30-04). Un seul poste par mode est renseigné (la grille est
 * projetée mode par mode) ; `null` = poste absent pour la tranche (part « garde »).
 */
export const GRILLE_PUBLIEE_V2_TYPE = 'referentiel.GrillePubliee.v2';

const centimes = z.number().int().nonnegative();

/**
 * Paramètres tarifaires ABCM (centimes) portés par `GrillePubliee.v2`. Tous
 * optionnels : seuls les postes du mode projeté sont renseignés.
 */
export const parametresGrilleSchema = z.object({
  cantineTotalCentimes: centimes.optional(),
  cantinePartGardeCentimes: centimes.nullable().optional(),
  periMatinCentimes: centimes.optional(),
  periSoirCentimes: centimes.optional(),
  alshJourneeCompleteCentimes: centimes.optional(),
  alshDemiJourneeCentimes: centimes.optional(),
  alshRepasCentimes: centimes.optional(),
});
export type ParametresGrille = z.infer<typeof parametresGrilleSchema>;

export const grillePublieeV2PayloadSchema = grillePublieePayloadSchema.extend({
  /** Montants (centimes) du mode projeté — cœur de la source de calcul (D1). */
  parametres: parametresGrilleSchema,
});
export type GrillePublieeV2Payload = z.infer<
  typeof grillePublieeV2PayloadSchema
>;

export const grillePublieeV2EventSchema = integrationEventSchema(
  grillePublieeV2PayloadSchema,
);
export type GrillePublieeV2Event = z.infer<typeof grillePublieeV2EventSchema>;

// --- referentiel.BaremePsuPublie.v1 -----------------------------------------

/**
 * Nom métier versionné (champ `type` de l'enveloppe). Le barème CNAF du taux
 * d'effort PSU devient un **événement** (SFD 30, D2) : le seed PSU l'émettait
 * jusqu'ici en silence. `svc-tarification` le projette et résout le taux **à
 * date** au lieu d'une constante figée (RM-30-04).
 */
export const BAREME_PSU_PUBLIE_TYPE = 'referentiel.BaremePsuPublie.v1';

export const baremePsuPubliePayloadSchema = z.object({
  baremeId: z.string().uuid(),
  /** Début de validité, ISO `YYYY-MM-DD`. */
  valideDu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  /** Fin de validité, ISO `YYYY-MM-DD`, ou `null` si période ouverte. */
  valideAu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .nullable(),
  /** Map `nbEnfantsACharge` (chaîne) → taux horaire CNAF (ex. `{ "1": 0.000619 }`). */
  taux: z.record(z.string(), z.number()),
  /** Plancher de ressources CNAF en centimes, ou `null` (doc 02 §3.1). */
  plancherCentimes: z.number().int().nullable(),
  /** Plafond de ressources CNAF en centimes, ou `null` (doc 02 §3.1). */
  plafondCentimes: z.number().int().nullable(),
});
export type BaremePsuPubliePayload = z.infer<
  typeof baremePsuPubliePayloadSchema
>;

export const baremePsuPublieEventSchema = integrationEventSchema(
  baremePsuPubliePayloadSchema,
);
export type BaremePsuPublieEvent = z.infer<typeof baremePsuPublieEventSchema>;

// --- referentiel.BaremeTranchesPublie.v1 ------------------------------------

/**
 * Nom métier versionné (champ `type` de l'enveloppe). Les **seuils de tranche RFR**
 * (20 000/50 000 €…) deviennent un **événement** versionné (SFD 30, D2/DV-03) : ils
 * étaient jusqu'ici figés dans `shared-kernel`. `svc-foyer` le projette et dérive la
 * tranche **à la date d'effet** d'une version de ressources (RM-30-04).
 */
export const BAREME_TRANCHES_PUBLIE_TYPE =
  'referentiel.BaremeTranchesPublie.v1';

/**
 * Un seuil du barème : `niveau` (1/2/3…) et `rfrMaxCentimes`, borne **haute
 * inclusive** de RFR (centimes) ; `null` = tranche ouverte (dernière). La liste est
 * ordonnée du plus bas au plus haut niveau ; le nombre de tranches est libre.
 */
export const seuilTrancheSchema = z.object({
  niveau: z.number().int().positive(),
  rfrMaxCentimes: z.number().int().nonnegative().nullable(),
});
export type SeuilTranchePayload = z.infer<typeof seuilTrancheSchema>;

export const baremeTranchesPubliePayloadSchema = z.object({
  baremeId: z.string().uuid(),
  /** Début de validité, ISO `YYYY-MM-DD`. */
  valideDu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  /** Fin de validité, ISO `YYYY-MM-DD`, ou `null` si période ouverte. */
  valideAu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .nullable(),
  /** Seuils ordonnés (croissant), nombre de tranches libre. */
  seuils: z.array(seuilTrancheSchema).min(1),
});
export type BaremeTranchesPubliePayload = z.infer<
  typeof baremeTranchesPubliePayloadSchema
>;

export const baremeTranchesPublieEventSchema = integrationEventSchema(
  baremeTranchesPubliePayloadSchema,
);
export type BaremeTranchesPublieEvent = z.infer<
  typeof baremeTranchesPublieEventSchema
>;

/**
 * **Inventaire** des types d'événement du contexte Référentiel — donc des sujets
 * NATS du stream `REFERENTIEL`. Même rôle et même porte que
 * `TYPES_EVENEMENTS_FOYER` (`pnpm abonnements`), cf. sa documentation.
 */
export const TYPES_EVENEMENTS_REFERENTIEL: readonly string[] = [
  GRILLE_PUBLIEE_TYPE,
  GRILLE_PUBLIEE_V2_TYPE,
  BAREME_PSU_PUBLIE_TYPE,
  BAREME_TRANCHES_PUBLIE_TYPE,
];
