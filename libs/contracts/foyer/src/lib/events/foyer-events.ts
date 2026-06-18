import { z } from 'zod';
import { integrationEventSchema } from '@creche-planner/contracts-kernel';

/**
 * Événements d'intégration du bounded context **Foyer** (doc 06 §8.5).
 * Émis par `svc-foyer` via l'outbox, publiés sur NATS JetStream. Les montants
 * voyagent en **centimes entiers** (cohérent avec `Money`) et la tranche RFR est
 * un dérivé transporté pour épargner aux consommateurs la connaissance du barème.
 */

/** Service émetteur (champ `source` de l'enveloppe). */
export const FOYER_EVENT_SOURCE = 'svc-foyer';

// --- Identités brandées (parse-don't-validate, doc 03 §3) -------------------
// Les identifiants UUID sont brandés via Zod : à la sortie d'un `.parse()` on
// obtient un type nominal (FoyerId/EnfantId) impossible à confondre avec un
// string brut ou un autre identifiant. Coût runtime nul (l'étiquette est
// effacée), validation faite à la frontière.
export const foyerIdSchema = z.string().uuid().brand<'FoyerId'>();
export type FoyerId = z.infer<typeof foyerIdSchema>;

export const enfantIdSchema = z.string().uuid().brand<'EnfantId'>();
export type EnfantId = z.infer<typeof enfantIdSchema>;

// --- foyer.FoyerMisAJour.v1 -------------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const FOYER_MIS_A_JOUR_TYPE = 'foyer.FoyerMisAJour.v1';

export const foyerMisAJourPayloadSchema = z.object({
  foyerId: foyerIdSchema,
  ressourcesMensuellesCentimes: z.number().int().nonnegative(),
  rfrCentimes: z.number().int().nonnegative(),
  nbEnfantsACharge: z.number().int().min(1),
  nbParts: z.number().positive(),
  /** Tranche RFR ABCM dérivée du RFR (1/2/3), transportée pour les consommateurs. */
  tranche: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type FoyerMisAJourPayload = z.infer<typeof foyerMisAJourPayloadSchema>;

export const foyerMisAJourEventSchema = integrationEventSchema(
  foyerMisAJourPayloadSchema,
);
export type FoyerMisAJourEvent = z.infer<typeof foyerMisAJourEventSchema>;

// --- foyer.FoyerMisAJour.v2 (rétrocompatible) -------------------------------

/**
 * **v2 rétrocompatible** de `foyer.FoyerMisAJour` (ADR-0004, décision 2 ; DEC-02).
 * Exerce réellement le versioning : un champ **optionnel** est ajouté sans rien
 * retirer ni renommer, de sorte qu'un payload v1 reste un payload v2 valide.
 *
 * Champ ajouté : `anneeRevenus` — l'année fiscale du RFR/des ressources
 * transportés (métadonnée d'audit). Optionnelle : un émetteur v1 ne la fournit
 * pas, un consommateur v2 sait l'exploiter quand elle est présente.
 */
export const FOYER_MIS_A_JOUR_V2_TYPE = 'foyer.FoyerMisAJour.v2';

export const foyerMisAJourPayloadV2Schema = foyerMisAJourPayloadSchema.extend({
  /** Année fiscale (ex. 2024) du RFR/des ressources. Optionnel pour rester rétrocompatible v1. */
  anneeRevenus: z.number().int().gte(2000).lte(2100).optional(),
});
export type FoyerMisAJourPayloadV2 = z.infer<
  typeof foyerMisAJourPayloadV2Schema
>;

export const foyerMisAJourEventV2Schema = integrationEventSchema(
  foyerMisAJourPayloadV2Schema,
);
export type FoyerMisAJourEventV2 = z.infer<typeof foyerMisAJourEventV2Schema>;

// --- foyer.EnfantAjoute.v1 --------------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const ENFANT_AJOUTE_TYPE = 'foyer.EnfantAjoute.v1';

export const enfantAjoutePayloadSchema = z.object({
  foyerId: foyerIdSchema,
  enfantId: enfantIdSchema,
  prenom: z.string().min(1),
  /** Date de naissance au format ISO `YYYY-MM-DD`. */
  dateNaissance: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
});
export type EnfantAjoutePayload = z.infer<typeof enfantAjoutePayloadSchema>;

export const enfantAjouteEventSchema = integrationEventSchema(
  enfantAjoutePayloadSchema,
);
export type EnfantAjouteEvent = z.infer<typeof enfantAjouteEventSchema>;
