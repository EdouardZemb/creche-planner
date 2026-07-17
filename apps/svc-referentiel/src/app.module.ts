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
import { REFERENTIEL_EVENT_SOURCE } from '@creche-planner/contracts-referentiel';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { ReferentielModule } from './referentiel/referentiel.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams('svc-referentiel')),
    DatabaseModule.forRoot({
      schema,
      urlBase: () => loadConfig().databaseUrl,
      // Migrations embarquées dans le bundle (assets webpack → dist/database/migrations).
      dossierMigrations: join(__dirname, 'database', 'migrations'),
    }),
    NatsModule.forRoot({
      service: 'svc-referentiel',
      stream: 'REFERENTIEL',
      sujet: 'referentiel.>',
      url: () => loadConfig().natsUrl,
    }),
    HealthModule,
    ReferentielModule,
    OutboxModule.forRoot({
      source: REFERENTIEL_EVENT_SOURCE,
      table: schema.outbox,
    }),
    // Guard aval d'assertion inter-services (observe-only) — fondations lot 3.
    AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig }),
  ],
})
export class AppModule {}
