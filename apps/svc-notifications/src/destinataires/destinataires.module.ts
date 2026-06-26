import { Module } from '@nestjs/common';
import { DestinatairesService } from './destinataires.service.js';

/**
 * Module **destinataires** (PR4 parents-foyer) : résout les e-mails des parents
 * actifs d'un foyer depuis le read model `foyer_parent`. Le client Drizzle est fourni
 * par le module global `DatabaseModule` ; ce service est consommé par le
 * `SchedulerModule` (envoi groupé du récap du mardi).
 */
@Module({
  providers: [DestinatairesService],
  exports: [DestinatairesService],
})
export class DestinatairesModule {}
