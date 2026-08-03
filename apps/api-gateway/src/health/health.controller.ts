import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { Public } from '../security/public.decorator.js';
import { AmontsHealthIndicator } from './amonts.health.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly amonts: AmontsHealthIndicator,
  ) {}

  /**
   * Readiness : la gateway n'est prête que si **toute la chaîne** l'est — la
   * readiness de chacun des 5 amonts, donc base + migrations + NATS de chacun
   * (lot B3). Consommée par la Porte 3 du déploiement, le smoke CI et le heartbeat.
   */
  @Get()
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check(this.amonts.sondes());
  }

  /** Liveness : le process gateway répond (aucune dépendance externe). */
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
