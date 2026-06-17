import { z } from 'zod';
import { integrationEventSchema } from '@creche-planner/contracts-kernel';

/**
 * Événements d'intégration du bounded context **Planification** (contrats de garde,
 * inscriptions ABCM, planning réel/simulé, doc 06 §9.3). Émis par `svc-planification`
 * via l'outbox, publiés sur NATS JetStream (stream `PLANIFICATION`, sujets
 * `planification.>`). Les consommateurs (Phase 6, `svc-tarification`) y apprennent
 * qu'un contrat est créé ou qu'un planning mensuel a changé.
 */

/** Service émetteur (champ `source` de l'enveloppe). */
export const PLANIFICATION_EVENT_SOURCE = 'svc-planification';

/** Modes de garde couverts par un contrat de garde. */
export const MODES_CONTRAT = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const;

// --- planification.ContratCree.v1 -------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_CREE_TYPE = 'planification.ContratCree.v1';

export const contratCreePayloadSchema = z.object({
  contratId: z.string().uuid(),
  foyerId: z.string().uuid(),
  /** Prénom de l'enfant concerné par le contrat (ex. "Mia"/"Zoé"). */
  enfant: z.string().min(1),
  /** Mode de garde du contrat. */
  mode: z.enum(MODES_CONTRAT),
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
export type ContratCreePayload = z.infer<typeof contratCreePayloadSchema>;

export const contratCreeEventSchema = integrationEventSchema(
  contratCreePayloadSchema,
);
export type ContratCreeEvent = z.infer<typeof contratCreeEventSchema>;

// --- planification.PlanningModifie.v1 ---------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const PLANNING_MODIFIE_TYPE = 'planification.PlanningModifie.v1';

export const planningModifiePayloadSchema = z.object({
  contratId: z.string().uuid(),
  /** Mois concerné, ISO `YYYY-MM`. */
  mois: z.string().regex(/^\d{4}-\d{2}$/, 'mois ISO YYYY-MM attendu'),
  /** `true` si planning simulé, `false` si planning réel. */
  simule: z.boolean(),
});
export type PlanningModifiePayload = z.infer<
  typeof planningModifiePayloadSchema
>;

export const planningModifieEventSchema = integrationEventSchema(
  planningModifiePayloadSchema,
);
export type PlanningModifieEvent = z.infer<typeof planningModifieEventSchema>;

// --- planification.ContratModifie.v1 ----------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_MODIFIE_TYPE = 'planification.ContratModifie.v1';

export const contratModifiePayloadSchema = z.object({
  contratId: z.string().uuid(),
  foyerId: z.string().uuid(),
  /** Prénom de l'enfant concerné par le contrat (ex. "Mia"/"Zoé"). */
  enfant: z.string().min(1),
  /** Mode de garde du contrat (peut changer en édition). */
  mode: z.enum(MODES_CONTRAT),
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
export type ContratModifiePayload = z.infer<typeof contratModifiePayloadSchema>;

export const contratModifieEventSchema = integrationEventSchema(
  contratModifiePayloadSchema,
);
export type ContratModifieEvent = z.infer<typeof contratModifieEventSchema>;

// --- planification.ContratSupprime.v1 ---------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_SUPPRIME_TYPE = 'planification.ContratSupprime.v1';

export const contratSupprimePayloadSchema = z.object({
  contratId: z.string().uuid(),
});
export type ContratSupprimePayload = z.infer<
  typeof contratSupprimePayloadSchema
>;

export const contratSupprimeEventSchema = integrationEventSchema(
  contratSupprimePayloadSchema,
);
export type ContratSupprimeEvent = z.infer<typeof contratSupprimeEventSchema>;
