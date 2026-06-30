import { Module } from '@nestjs/common';
import { EtablissementProjeteService } from './etablissement-projete.service.js';

/**
 * Module **établissements** du domaine notifications. Le client Drizzle est fourni par
 * le module global `DatabaseModule`.
 *
 * - `EtablissementProjeteService` : lecture du **read model projeté** `etablissement`
 *   (entité libre par foyer, source de vérité `svc-planification`, P3) — c'est lui qui
 *   route les récaps (envoi & scheduler) via `contrat.etablissement_id`.
 *
 * L'ancien annuaire à clé fermée (`EtablissementService` + table
 * `etablissement_destinataire` + CRUD `/api/etablissements`) a été **démantelé en P6**.
 */
@Module({
  providers: [EtablissementProjeteService],
  exports: [EtablissementProjeteService],
})
export class EtablissementModule {}
