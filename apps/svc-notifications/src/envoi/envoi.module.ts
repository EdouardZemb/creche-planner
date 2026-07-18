import { Module } from '@nestjs/common';
import { EtablissementModule } from '../etablissement/etablissement.module.js';
import { CLOCK, horlogeSysteme } from '../scheduler/clock.js';
import { EnvoiController } from './envoi.controller.js';
import { EnvoiService } from './envoi.service.js';
import { SuiviEnvoisService } from './suivi-envois.service.js';

/**
 * Module **mail au service** (Lot 6) : relecture (brouillon régénérable) puis envoi
 * réel tracé. Le `MailerService` est fourni par le module global `EmailModule` (câblé
 * dans `AppModule`, garde-fous dry-run/allowlist) et le client Drizzle par
 * `DatabaseModule`. On importe `EtablissementModule` pour résoudre le destinataire via
 * le read model projeté (`EtablissementProjeteService`, routé par `contrat.etablissement_id`).
 * L'horloge système (`CLOCK`, mockée en test) date la finalisation des envois et mesure
 * l'âge d'une réservation `EN_COURS` bloquée pour décider d'une reprise (Lot 5).
 * `SuiviEnvoisService` (B1) expose, en **lecture seule**, le statut persistant des
 * envois d'une semaine (rappel aux parents + récaps aux établissements).
 */
@Module({
  imports: [EtablissementModule],
  controllers: [EnvoiController],
  providers: [
    EnvoiService,
    SuiviEnvoisService,
    { provide: CLOCK, useValue: horlogeSysteme },
  ],
})
export class EnvoiModule {}
