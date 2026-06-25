import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from '@creche-planner/observability';
import {
  DatabaseModule,
  HealthModule,
  NatsModule,
} from '@creche-planner/nest-commons';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { EtablissementModule } from './etablissement/etablissement.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams('svc-notifications')),
    DatabaseModule.forRoot({
      schema,
      urlBase: () => loadConfig().databaseUrl,
      // Migrations embarquées dans le bundle (assets webpack → dist/database/migrations).
      dossierMigrations: join(__dirname, 'database', 'migrations'),
    }),
    NatsModule.forRoot({
      service: 'svc-notifications',
      stream: 'NOTIFICATIONS',
      sujet: 'notifications.>',
      url: () => loadConfig().natsUrl,
    }),
    HealthModule,
    ConsumersModule,
    EtablissementModule,
  ],
})
export class AppModule {}
