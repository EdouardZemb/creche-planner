import { Module } from '@nestjs/common';
import { type Abonnement, ConsumerModule } from '@creche-planner/nest-commons';
import * as schema from '../database/schema.js';
import { ProjectionService } from './projection.service.js';

/** Streams amont consommés par Planification, et leur consommateur durable. */
const ABONNEMENTS: readonly Abonnement[] = [
  // Enfants du foyer : rafraîchit la dénormalisation `contrat.enfant` (prénom)
  // quand un enfant est renommé (`foyer.EnfantModifie.v1`).
  { stream: 'FOYER', durable: 'planification-foyer' },
];

/**
 * Consommateur idempotent JetStream du stream `FOYER` : rafraîchit la
 * dénormalisation `contrat.enfant` (prénom) au renommage d'un enfant et ré-émet
 * `ContratModifie` pour les read-models aval. La mécanique de consommation
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
