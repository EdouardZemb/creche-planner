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
} from '@creche-planner/nest-commons';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { FallbackModule } from './fallback/fallback.module.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { TarificationModule } from './tarification/tarification.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams('svc-tarification')),
    DatabaseModule.forRoot({
      schema,
      urlBase: () => loadConfig().databaseUrl,
      // Migrations embarquées dans le bundle (assets webpack → dist/database/migrations).
      dossierMigrations: join(__dirname, 'database', 'migrations'),
    }),
    NatsModule.forRoot({
      service: 'svc-tarification',
      stream: 'TARIFICATION',
      sujet: 'tarification.>',
      url: () => loadConfig().natsUrl,
    }),
    HealthModule,
    FallbackModule,
    ConsumersModule,
    TarificationModule,
    // Guard aval d'assertion inter-services (observe-only) — fondations lot 3, +
    // scoping par ressource (lot 4). svc-tarification scope en **direct** (les deux
    // routes coûts portent `?foyer=`) → aucun résolveur en base (`scoping: {}`).
    AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig, scoping: {} }),
  ],
})
export class AppModule {}
