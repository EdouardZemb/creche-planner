import { Module } from '@nestjs/common';
import { type Abonnement, ConsumerModule } from '@creche-planner/nest-commons';
import * as schema from '../database/schema.js';
import { ProjectionService } from './projection.service.js';

/** Streams amont consommés par Notifications, et leur consommateur durable. */
const ABONNEMENTS: readonly Abonnement[] = [
  { stream: 'PLANIFICATION', durable: 'notifications-planification' },
  // Parents du foyer : projette `foyer_parent`/préférences pour router le récap.
  { stream: 'FOYER', durable: 'notifications-foyer' },
];

/**
 * Consommateurs idempotents JetStream alimentant les read models du service
 * Notifications (streams `PLANIFICATION` et `FOYER`). La mécanique de consommation
 * (binding résilient, ACK/NAK, dead-letter, arrêt propre) est mutualisée dans
 * `ConsumerModule` ; ce module ne fournit que ses abonnements, sa table
 * `dead_letter` et sa `ProjectionService`.
 */
@Module({
  imports: [
    ConsumerModule.forRoot({
      abonnements: ABONNEMENTS,
      tableDeadLetter: schema.deadLetter,
      projection: ProjectionService,
    }),
  ],
  exports: [ConsumerModule],
})
export class ConsumersModule {}
