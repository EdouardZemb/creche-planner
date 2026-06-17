import { z } from 'zod';

/**
 * Enveloppe générique d'un **événement d'intégration** publié sur NATS JetStream
 * via l'outbox (doc 03 §9bis). Squelette de Phase 1 : aucun événement métier réel
 * n'est encore défini — seul le contrat d'enveloppe (versionné, idempotent, tracé)
 * est figé ici.
 *
 * - `id`     : identifiant unique de l'événement, sert de **clé d'idempotence**.
 * - `type`   : nom métier au passé, versionné (ex. `referentiel.GrillePubliee.v1`).
 * - `source` : service émetteur (ex. `svc-referentiel`).
 * - `version`: version du schéma de `payload`.
 * - `occurredAt` : horodatage ISO 8601 de l'occurrence métier.
 * - `traceId`: identifiant de trace OpenTelemetry pour la corrélation distribuée.
 */
export const integrationEventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  source: z.string().min(1),
  version: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  traceId: z.string().min(1),
});

export type IntegrationEventEnvelope = z.infer<
  typeof integrationEventEnvelopeSchema
>;

export interface IntegrationEvent<TPayload> extends IntegrationEventEnvelope {
  readonly payload: TPayload;
}

/**
 * Construit le schéma complet d'un événement en greffant un schéma de `payload`
 * sur l'enveloppe. À utiliser par chaque contexte quand il définira ses propres
 * événements (Phases 3+).
 */
export function integrationEventSchema<TPayload extends z.ZodTypeAny>(
  payload: TPayload,
) {
  return integrationEventEnvelopeSchema.extend({ payload });
}
