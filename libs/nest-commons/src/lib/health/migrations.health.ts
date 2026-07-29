import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { MigrationService } from '../database/migration.service.js';

/**
 * Sonde readiness de l'état du schéma : down tant que les migrations Drizzle ne
 * sont pas appliquées. Un service dont la migration boucle en retry (base OK mais
 * migration en échec) ne doit pas se déclarer prêt à recevoir du trafic — sa base
 * répond, mais son schéma est en retard. Readiness **seulement** : la liveness ne
 * dépend pas de cette sonde (pas de restart en boucle pendant le retry).
 */
@Injectable()
export class MigrationsHealthIndicator {
  constructor(
    private readonly migrations: MigrationService,
    private readonly health: HealthIndicatorService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.health.check(key);
    if (this.migrations.sontAppliquees()) {
      return indicator.up();
    }
    return indicator.down({
      message:
        this.migrations.derniereErreur() ?? 'migrations non encore appliquées',
    });
  }
}
