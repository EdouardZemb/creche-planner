import { type DynamicModule, Module } from '@nestjs/common';
import { OPTIONS_MAILER, type OptionsMailer } from './mailer.options.js';
import { MailerService } from './mailer.service.js';

/**
 * Module e-mail applicatif (token `OPTIONS_MAILER` + `MailerService`), sur le
 * modèle de `NatsModule.forRoot`/`DatabaseModule.forRoot`. Global : un seul
 * service importe ce module (svc-notifications) et le `MailerService` reste
 * injectable partout dans son contexte.
 */
@Module({})
export class EmailModule {
  static forRoot(options: OptionsMailer): DynamicModule {
    return {
      module: EmailModule,
      global: true,
      providers: [
        { provide: OPTIONS_MAILER, useValue: options },
        MailerService,
      ],
      exports: [MailerService],
    };
  }
}
