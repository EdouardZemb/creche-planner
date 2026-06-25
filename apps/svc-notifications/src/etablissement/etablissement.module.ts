import { Module } from '@nestjs/common';
import { EtablissementController } from './etablissement.controller.js';
import { EtablissementService } from './etablissement.service.js';

/**
 * Module **établissements destinataires** (Lot 3) : annuaire de contacts du domaine
 * notifications. Le client Drizzle est fourni par le module global `DatabaseModule`.
 * Le service seede les 2 établissements au démarrage et expose la lecture/upsert.
 */
@Module({
  controllers: [EtablissementController],
  providers: [EtablissementService],
  exports: [EtablissementService],
})
export class EtablissementModule {}
