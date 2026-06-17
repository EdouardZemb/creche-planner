import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';
import { NatsHealthIndicator } from './nats.health.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly nats: NatsHealthIndicator,
  ) {}

  /** Readiness : prêt à recevoir du trafic (dépendances DB + NATS vérifiées). */
  @Get()
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.nats.isHealthy('nats'),
    ]);
  }

  /** Liveness : le process répond (aucune dépendance externe). */
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
