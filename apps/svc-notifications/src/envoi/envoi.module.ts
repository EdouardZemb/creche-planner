import { Module } from '@nestjs/common';
import { EtablissementModule } from '../etablissement/etablissement.module.js';
import { EnvoiController } from './envoi.controller.js';
import { EnvoiService } from './envoi.service.js';

/**
 * Module **mail au service** (Lot 6) : relecture (brouillon régénérable) puis envoi
 * réel tracé. Le `MailerService` est fourni par le module global `EmailModule` (câblé
 * dans `AppModule`, garde-fous dry-run/allowlist) et le client Drizzle par
 * `DatabaseModule`. On importe `EtablissementModule` pour résoudre le destinataire via
 * le read model projeté (`EtablissementProjeteService`, routé par `contrat.etablissement_id`).
 */
@Module({
  imports: [EtablissementModule],
  controllers: [EnvoiController],
  providers: [EnvoiService],
})
export class EnvoiModule {}
