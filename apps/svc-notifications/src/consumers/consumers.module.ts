import { Module } from '@nestjs/common';
import { JetStreamConsumer } from './jetstream.consumer.js';
import { ProjectionService } from './projection.service.js';

/**
 * Consommateur idempotent JetStream alimentant le read model des contrats du service
 * Notifications (stream `PLANIFICATION`). `NatsService` et le client Drizzle sont
 * fournis par des modules globaux.
 */
@Module({
  providers: [JetStreamConsumer, ProjectionService],
  exports: [ProjectionService],
})
export class ConsumersModule {}
