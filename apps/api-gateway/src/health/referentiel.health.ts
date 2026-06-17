import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { loadConfig } from '../config.js';

/** Readiness aval : la gateway n'est « prête » que si le référentiel répond. */
@Injectable()
export class ReferentielHealthIndicator {
  constructor(private readonly health: HealthIndicatorService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.health.check(key);
    try {
      const reponse = await fetch(
        `${loadConfig().referentielUrl}/api/health/live`,
      );
      return reponse.ok
        ? indicator.up()
        : indicator.down({ httpStatus: reponse.status });
    } catch (erreur) {
      return indicator.down({ message: (erreur as Error).message });
    }
  }
}
