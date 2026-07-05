import { Module } from '@nestjs/common';
import { JetStreamConsumer } from './jetstream.consumer.js';
import { ProjectionService } from './projection.service.js';

/**
 * Consommateur idempotent JetStream du stream `FOYER` : rafraîchit la
 * dénormalisation `contrat.enfant` (prénom) au renommage d'un enfant et ré-émet
 * `ContratModifie` pour les read-models aval. `NatsService` et la base sont
 * fournis par des modules globaux.
 */
@Module({
  providers: [JetStreamConsumer, ProjectionService],
  exports: [ProjectionService],
})
export class ConsumersModule {}
