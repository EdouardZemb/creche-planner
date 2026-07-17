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
import { FOYER_EVENT_SOURCE } from '@creche-planner/contracts-foyer';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { FoyerModule } from './foyer/foyer.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams('svc-foyer')),
    DatabaseModule.forRoot({
      schema,
      urlBase: () => loadConfig().databaseUrl,
      // Migrations embarquées dans le bundle (assets webpack → dist/database/migrations).
      dossierMigrations: join(__dirname, 'database', 'migrations'),
    }),
    NatsModule.forRoot({
      service: 'svc-foyer',
      stream: 'FOYER',
      sujet: 'foyer.>',
      url: () => loadConfig().natsUrl,
    }),
    HealthModule,
    FoyerModule,
    OutboxModule.forRoot({ source: FOYER_EVENT_SOURCE, table: schema.outbox }),
    // Guard aval d'assertion inter-services (observe-only tant qu'aucun
    // INTERSERVICE_AUTHZ_ENFORCE=1 n'est posé) — fondations lot 3, + scoping par
    // ressource (lot 4). svc-foyer scope en **direct** (foyer `:id`, e-mails
    // `createurEmail`/`parentEmail`) → aucun résolveur en base (`scoping: {}`).
    AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig, scoping: {} }),
  ],
})
export class AppModule {}
