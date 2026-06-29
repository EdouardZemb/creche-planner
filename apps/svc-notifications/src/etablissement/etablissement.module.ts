import { Module } from '@nestjs/common';
import { EtablissementController } from './etablissement.controller.js';
import { EtablissementService } from './etablissement.service.js';

/**
 * Module **établissements destinataires** (Lot 3) : annuaire legacy à clé fermée du
 * domaine notifications. Le client Drizzle est fourni par le module global
 * `DatabaseModule`. Depuis P3, le service **ne seede plus** (la source de vérité est
 * `svc-planification`, projetée dans le read model `etablissement`) ; il n'expose que
 * la lecture/upsert, le temps que les flux d'envoi encore keyés `cle` migrent (PR
 * suivant) avant démantèlement (P6).
 */
@Module({
  controllers: [EtablissementController],
  providers: [EtablissementService],
  exports: [EtablissementService],
})
export class EtablissementModule {}
