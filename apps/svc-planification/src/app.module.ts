import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from '@creche-planner/observability';
import {
  AssertionIdentiteModule,
  DatabaseModule,
  HealthModule,
  NatsModule,
  OutboxModule,
} from '@creche-planner/nest-commons';
import { PLANIFICATION_EVENT_SOURCE } from '@creche-planner/contracts-planification';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { PlanificationModule } from './planification/planification.module.js';
import { EtablissementModule } from './etablissement/etablissement.module.js';
import { ResolveurFoyerPlanification } from './security/resolveur-foyer.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams('svc-planification')),
    DatabaseModule.forRoot({
      schema,
      urlBase: () => loadConfig().databaseUrl,
      // Migrations embarquées dans le bundle (assets webpack → dist/database/migrations).
      dossierMigrations: join(__dirname, 'database', 'migrations'),
    }),
    NatsModule.forRoot({
      service: 'svc-planification',
      stream: 'PLANIFICATION',
      sujet: 'planification.>',
      url: () => loadConfig().natsUrl,
    }),
    HealthModule,
    ConsumersModule,
    PlanificationModule,
    EtablissementModule,
    OutboxModule.forRoot({
      source: PLANIFICATION_EVENT_SOURCE,
      table: schema.outbox,
    }),
    // Guard aval d'assertion inter-services (observe-only) — fondations lot 3, +
    // scoping par ressource (lot 4). Les routes `/contrats/:id…` et
    // `/etablissements/:id` ne portent pas le foyer → résolution locale (contrat /
    // établissement → foyer_id) par `ResolveurFoyerPlanification`.
    AssertionIdentiteModule.forRoot({
      chargerConfig: loadConfig,
      scoping: { resolveur: ResolveurFoyerPlanification },
    }),
  ],
})
export class AppModule {}
