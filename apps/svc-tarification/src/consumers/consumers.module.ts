import { Module } from '@nestjs/common';
import { JetStreamConsumer } from './jetstream.consumer.js';
import { ProjectionService } from './projection.service.js';

/**
 * Consommateurs idempotents JetStream alimentant le read model Tarification
 * (streams `FOYER`/`REFERENTIEL`/`PLANIFICATION`). `NatsService` et les clients de
 * repli sont fournis par des modules globaux.
 */
@Module({
  providers: [JetStreamConsumer, ProjectionService],
  exports: [ProjectionService],
})
export class ConsumersModule {}
