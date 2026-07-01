import { Module } from '@nestjs/common';
import { DesabonnementClient } from './desabonnement.client.js';

/**
 * Module **désabonnement** (PR5, RFC 8058) : expose le client d'émission des jetons
 * one-click vers `svc-foyer`. Consommé par le `SchedulerModule` (le récap du mardi
 * frappe un jeton par destinataire pour poser l'en-tête `List-Unsubscribe`).
 */
@Module({
  providers: [DesabonnementClient],
  exports: [DesabonnementClient],
})
export class DesabonnementModule {}
