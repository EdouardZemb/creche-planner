import { Module } from '@nestjs/common';
import { loadConfig } from '../config.js';
import { EtablissementModule } from '../etablissement/etablissement.module.js';
import { ValidationModule } from '../validation/validation.module.js';
import { DestinatairesModule } from '../destinataires/destinataires.module.js';
import { DesabonnementModule } from '../desabonnement/desabonnement.module.js';
import { InboxModule } from '../inbox/inbox.module.js';
import { CLOCK, horlogeSysteme } from './clock.js';
import { EnvoiRecapService } from './envoi-recap.service.js';
import { SchedulerHebdo } from './scheduler.hebdo.js';
import { OPTIONS_SCHEDULER } from './scheduler.options.js';

/**
 * Module **scheduler hebdomadaire** (Lot 5). Le `MailerService` est fourni par le
 * module global `EmailModule` (câblé dans `AppModule`) et le client Drizzle par
 * `DatabaseModule` ; ce module n'apporte que l'horloge système (`CLOCK`, mockée en
 * test), les options de déclenchement, le journal d'envoi du récap
 * (`EnvoiRecapService`, statut persisté + reprise, Lot 3) et le scheduler lui-même. Il
 * réutilise
 * `ValidationService` (notification idempotente), `EtablissementProjeteService`
 * (résolution du préavis du mail via le read model projeté, routé par
 * `contrat.etablissement_id`) et `DestinatairesService` (e-mails des parents actifs du
 * foyer, PR4) via leurs modules.
 */
@Module({
  imports: [
    ValidationModule,
    EtablissementModule,
    DestinatairesModule,
    DesabonnementModule,
    InboxModule,
  ],
  providers: [
    SchedulerHebdo,
    EnvoiRecapService,
    { provide: CLOCK, useValue: horlogeSysteme },
    {
      provide: OPTIONS_SCHEDULER,
      useFactory: () => {
        const config = loadConfig();
        return {
          heureDeclenchement: config.schedulerHeure,
          forcerFenetre: config.schedulerForcer,
          emailParent: config.email.parent,
          appUrl: config.appUrl,
          publicApiUrl: config.publicApiUrl,
          unsubscribeMailto: config.unsubscribeMailto,
        };
      },
    },
  ],
})
export class SchedulerModule {}
