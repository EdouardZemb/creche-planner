import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from '@creche-planner/observability';
import {
  DatabaseModule,
  EmailModule,
  HealthModule,
  NatsModule,
  type OptionsMailer,
} from '@creche-planner/nest-commons';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { EtablissementModule } from './etablissement/etablissement.module.js';
import { ValidationModule } from './validation/validation.module.js';
import { EnvoiModule } from './envoi/envoi.module.js';
import { InboxModule } from './inbox/inbox.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';

/**
 * Options du mailer dérivées de la config. Le mot de passe est résolu
 * **paresseusement** (`passwordProvider`) : le secret n'est lu qu'au 1ᵉʳ envoi réel,
 * jamais figé à l'instanciation du module.
 */
function optionsMailer(): OptionsMailer {
  const { email } = loadConfig();
  return {
    host: email.host,
    port: email.port,
    user: email.user,
    passwordProvider: () => loadConfig().email.password,
    from: email.from,
    dryRun: email.dryRun,
    allowlist: email.allowlist,
  };
}

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
    EmailModule.forRoot(optionsMailer()),
    HealthModule,
    ConsumersModule,
    EtablissementModule,
    ValidationModule,
    EnvoiModule,
    InboxModule,
    SchedulerModule,
  ],
})
export class AppModule {}
