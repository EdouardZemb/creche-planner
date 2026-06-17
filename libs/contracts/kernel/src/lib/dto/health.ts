import { z } from 'zod';

/**
 * Contrat de réponse `/health` partagé par la gateway et les services
 * (forme alignée sur `@nestjs/terminus`). C'est le seul DTO « réel » de Phase 1 :
 * il rend la sonde liveness/readiness contractuelle et validable.
 */
const healthIndicatorSchema = z
  .object({ status: z.string() })
  .catchall(z.unknown());

export const healthCheckResultSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  info: z.record(z.string(), healthIndicatorSchema).optional(),
  error: z.record(z.string(), healthIndicatorSchema).optional(),
  details: z.record(z.string(), healthIndicatorSchema),
});

export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>;
