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
