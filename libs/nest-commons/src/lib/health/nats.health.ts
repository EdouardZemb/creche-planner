import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { NatsService } from '../messaging/nats.service.js';

/** Sonde readiness de la connexion NATS JetStream. */
@Injectable()
export class NatsHealthIndicator {
  constructor(
    private readonly nats: NatsService,
    private readonly health: HealthIndicatorService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.health.check(key);
    return this.nats.estConnecte() ? indicator.up() : indicator.down();
  }
}
