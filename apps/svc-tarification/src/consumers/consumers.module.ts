import { Module } from '@nestjs/common';
import { type Abonnement, ConsumerModule } from '@creche-planner/nest-commons';
import * as schema from '../database/schema.js';
import { ProjectionService } from './projection.service.js';

/** Streams amont consommés par Tarification, et leur consommateur durable. */
const ABONNEMENTS: readonly Abonnement[] = [
  { stream: 'FOYER', durable: 'tarification-foyer' },
  { stream: 'REFERENTIEL', durable: 'tarification-referentiel' },
  { stream: 'PLANIFICATION', durable: 'tarification-planification' },
];

/**
 * Consommateurs idempotents JetStream alimentant le read model Tarification
 * (streams `FOYER`/`REFERENTIEL`/`PLANIFICATION`). La mécanique de consommation
 * (binding résilient, ACK/NAK, dead-letter, arrêt propre) est mutualisée dans
 * `ConsumerModule` ; ce module ne fournit que ses abonnements, sa table
 * `dead_letter` et sa `ProjectionService` (les clients de repli globaux —
 * `FallbackModule` — restent injectables dans celle-ci).
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
