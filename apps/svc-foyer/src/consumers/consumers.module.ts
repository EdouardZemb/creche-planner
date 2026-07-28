import { Module } from '@nestjs/common';
import { type Abonnement, ConsumerModule } from '@creche-planner/nest-commons';
import * as schema from '../database/schema.js';
import { ProjectionService } from './projection.service.js';

/** Streams amont consommés par Foyer, et leur consommateur durable. */
const ABONNEMENTS: readonly Abonnement[] = [
  { stream: 'REFERENTIEL', durable: 'foyer-referentiel' },
];

/**
 * Consommateur idempotent JetStream alimentant le read-model local de Foyer (barème
 * de seuils de tranche, stream `REFERENTIEL`) — SFD 30, D2. C'est la **première**
 * infra de consommation de svc-foyer : la mécanique (binding résilient, ACK/NAK,
 * dead-letter, arrêt propre) est mutualisée dans `ConsumerModule` ; ce module ne
 * fournit que son abonnement, sa table `dead_letter` et sa `ProjectionService`.
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
