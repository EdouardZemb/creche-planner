import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { AssertionPubliqueInterServices } from '../security/assertion-publique.decorator.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { NatsHealthIndicator } from './nats.health.js';

/**
 * Sondes de santé — **exemptées** de l'assertion inter-services
 * ({@link AssertionPubliqueInterServices}) : les healthchecks docker et le
 * blackbox-exporter les appellent **sans** en-tête. L'exemption est non négociable,
 * sinon tout le monitoring tomberait au premier passage en enforce.
 */
@AssertionPubliqueInterServices()
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
