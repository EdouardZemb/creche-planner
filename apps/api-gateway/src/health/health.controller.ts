import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { FormatErreurNatif } from '../erreurs/format-erreur-natif.decorator.js';
import { Public } from '../security/public.decorator.js';
import { AmontsHealthIndicator } from './amonts.health.js';

@Public()
// Le 503 de readiness **est** le rapport de santé : il nomme l'amont tombé, et
// c'est ce que lisent la Porte 3 du déploiement et le heartbeat. Seule famille de
// routes exemptée du format `application/problem+json` (cf. le décorateur).
@FormatErreurNatif()
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
