import { Controller, Get, Logger } from '@nestjs/common';
import {
  healthCheckResultSchema,
  type HealthCheckResult,
} from '@creche-planner/contracts-kernel';
import { Public } from '../security/public.decorator.js';
import { loadConfig } from '../config.js';

/**
 * Façade gateway → svc-referentiel. Réalise le parcours distribué de la DoD :
 * `requête → api-gateway → svc-referentiel → /health → DB`. L'appel `fetch` est
 * auto-instrumenté (OpenTelemetry/undici) : le `traceparent` est propagé et la
 * réponse est validée contre le contrat partagé (libs/contracts).
 */
@Public()
@Controller('referentiel')
export class ReferentielController {
  private readonly logger = new Logger(ReferentielController.name);

  @Get('health')
  async health(): Promise<HealthCheckResult> {
    const url = `${loadConfig().referentielUrl}/api/health`;
    this.logger.log(`Appel aval du référentiel : ${url}`);
    const reponse = await fetch(url);
    const corps: unknown = await reponse.json();
    return healthCheckResultSchema.parse(corps);
  }
}
