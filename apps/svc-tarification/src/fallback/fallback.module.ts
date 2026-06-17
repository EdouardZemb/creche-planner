import { Global, Module } from '@nestjs/common';
import { FoyerClient } from './foyer.client.js';
import { PlanificationClient } from './planification.client.js';
import { ReferentielClient } from './referentiel.client.js';

/**
 * Clients de **repli synchrone** (timeout / retry / circuit-breaker) vers les
 * services amont. Exportés globalement : consommateur d'événements et API coût
 * s'en servent quand le read model est froid/incomplet.
 */
@Global()
@Module({
  providers: [FoyerClient, PlanificationClient, ReferentielClient],
  exports: [FoyerClient, PlanificationClient, ReferentielClient],
})
export class FallbackModule {}
