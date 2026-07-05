import { z } from 'zod';
import { integrationEventSchema } from '@creche-planner/contracts-kernel';

/**
 * Événements d'intégration du bounded context **Notifications** (doc 06 §8.5).
 * Émis par `svc-notifications` via l'outbox (jusqu'ici latente), publiés sur NATS
 * JetStream (stream `NOTIFICATIONS`, sujets `notifications.>`).
 */

/** Service émetteur (champ `source` de l'enveloppe). */
export const NOTIFICATIONS_EVENT_SOURCE = 'svc-notifications';

// --- notifications.SemaineValidee.v1 ----------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const SEMAINE_VALIDEE_TYPE = 'notifications.SemaineValidee.v1';

/**
 * Statut final d'une semaine validée par un parent. Sous-ensemble **terminal** des
 * statuts de `notification_hebdo` : `A_VALIDER` n'apparaît jamais ici, l'événement
 * n'est émis qu'à la transition réelle (jamais lors d'une revalidation idempotente).
 */
export const STATUTS_SEMAINE_VALIDEE = [
  'VALIDEE',
  'VALIDEE_AVEC_MODIFS',
] as const;
export const statutSemaineValideeSchema = z.enum(STATUTS_SEMAINE_VALIDEE);
export type StatutSemaineValidee = z.infer<typeof statutSemaineValideeSchema>;

/**
 * Un jour dont les entrées diffèrent entre le snapshot notifié (`avant`) et la
 * relecture du planning à la validation (`apres`) — `null` = jour absent d'un côté.
 * Le contenu d'un jour reste **opaque** au contrat (catégories datées du planning,
 * possédées par le contexte planification) : les consommateurs n'ont besoin que du
 * fait qu'un jour a changé, pas d'en interpréter le détail.
 */
export const deltaJourSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  avant: z.record(z.string(), z.unknown()).nullable(),
  apres: z.record(z.string(), z.unknown()).nullable(),
});
export type DeltaJourValide = z.infer<typeof deltaJourSchema>;

/** Ensemble des jours modifiés entre notification et validation (jamais vide ici). */
export const deltaModifsSchema = z.object({
  jours: z.array(deltaJourSchema).readonly(),
});
export type DeltaModifsValides = z.infer<typeof deltaModifsSchema>;

/**
 * Une semaine notifiée vient d'être **validée** par un parent (transition
 * `A_VALIDER` → `VALIDEE`/`VALIDEE_AVEC_MODIFS`, `ValidationService.valider`).
 * Émis **une seule fois** par semaine notifiée, dans la même transaction que la
 * mise à jour du statut (outbox) — les revalidations idempotentes n'émettent rien.
 * `deltaModifs` n'est présent que pour `VALIDEE_AVEC_MODIFS` (planning modifié
 * entre la notification et la validation).
 */
export const semaineValideePayloadSchema = z.object({
  contratId: z.uuid(),
  /** Semaine ISO 8601 validée (ex. `2026-W27`). */
  semaineIso: z
    .string()
    .regex(/^\d{4}-W\d{2}$/, 'semaine ISO YYYY-Www attendue'),
  statut: statutSemaineValideeSchema,
  deltaModifs: deltaModifsSchema.optional(),
});
export type SemaineValideePayload = z.infer<typeof semaineValideePayloadSchema>;

export const semaineValideeEventSchema = integrationEventSchema(
  semaineValideePayloadSchema,
);
export type SemaineValideeEvent = z.infer<typeof semaineValideeEventSchema>;
