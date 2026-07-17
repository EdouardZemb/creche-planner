import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from '@creche-planner/observability';
import {
  AssertionIdentiteModule,
  DatabaseModule,
  EmailModule,
  HealthModule,
  NatsModule,
  OutboxModule,
  type OptionsMailer,
} from '@creche-planner/nest-commons';
import { NOTIFICATIONS_EVENT_SOURCE } from '@creche-planner/contracts-notifications';
import { loadConfig } from './config.js';
import * as schema from './database/schema.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { EtablissementModule } from './etablissement/etablissement.module.js';
import { ValidationModule } from './validation/validation.module.js';
import { EnvoiModule } from './envoi/envoi.module.js';
import { InboxModule } from './inbox/inbox.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { ResolveurFoyerNotifications } from './security/resolveur-foyer.js';

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
    // Relais de l'outbox (jusqu'ici latente) : publie `notifications.SemaineValidee.v1`
    // inséré par `ValidationService.valider` dans la même transaction que la
    // transition de statut.
    OutboxModule.forRoot({
      source: NOTIFICATIONS_EVENT_SOURCE,
      table: schema.outbox,
    }),
    EmailModule.forRoot(optionsMailer()),
    HealthModule,
    ConsumersModule,
    EtablissementModule,
    ValidationModule,
    EnvoiModule,
    InboxModule,
    SchedulerModule,
    // Guard aval d'assertion inter-services (observe-only) — fondations lot 3, +
    // scoping par ressource (lot 4). La validation porte un contratId et l'inbox un
    // parentId → résolution locale (contrat → foyer, parent → e-mail propriétaire)
    // par `ResolveurFoyerNotifications`.
    AssertionIdentiteModule.forRoot({
      chargerConfig: loadConfig,
      scoping: { resolveur: ResolveurFoyerNotifications },
    }),
  ],
})
export class AppModule {}
