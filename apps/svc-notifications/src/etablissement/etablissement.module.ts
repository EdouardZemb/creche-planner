import { Module } from '@nestjs/common';
import { EtablissementController } from './etablissement.controller.js';
import { EtablissementService } from './etablissement.service.js';
import { EtablissementProjeteService } from './etablissement-projete.service.js';

/**
 * Module **établissements** du domaine notifications. Le client Drizzle est fourni par
 * le module global `DatabaseModule`. Deux services y cohabitent le temps de la
 * transition :
 *
 * - `EtablissementProjeteService` : lecture du **read model projeté** `etablissement`
 *   (entité libre par foyer, source de vérité `svc-planification`, P3) — c'est lui qui
 *   route désormais les récaps (envoi & scheduler) via `contrat.etablissement_id` ;
 * - `EtablissementService` : annuaire **legacy** à clé fermée (`etablissement_destinataire`),
 *   qui **ne seede plus** (P3) et ne sert plus qu'au CRUD legacy `/api/etablissements`
 *   (Pact) en attendant son démantèlement (P6).
 */
@Module({
  controllers: [EtablissementController],
  providers: [EtablissementService, EtablissementProjeteService],
  exports: [EtablissementService, EtablissementProjeteService],
})
export class EtablissementModule {}
