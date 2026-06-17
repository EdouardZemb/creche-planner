import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';

const TRACE_ID_VIDE = '00000000000000000000000000000000';

/**
 * Identifiant de trace OpenTelemetry du span courant, pour corréler l'événement
 * d'intégration à la requête qui l'a produit. Repli sur un UUID si aucun span
 * actif (ex. tâche de fond hors requête HTTP).
 */
export function traceIdCourant(): string {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  return traceId && traceId !== TRACE_ID_VIDE
    ? traceId
    : randomUUID().replace(/-/g, '');
}
