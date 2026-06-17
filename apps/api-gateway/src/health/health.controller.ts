import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { Public } from '../security/public.decorator.js';
import { ReferentielHealthIndicator } from './referentiel.health.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly referentiel: ReferentielHealthIndicator,
  ) {}

  /** Readiness : la gateway est prête si son dépendant (référentiel) répond. */
  @Get()
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.referentiel.isHealthy('svc-referentiel'),
    ]);
  }

  /** Liveness : le process gateway répond (aucune dépendance externe). */
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
