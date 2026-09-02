import { Module } from '@nestjs/common';
import { CalendrierModule } from '../calendrier/calendrier.module.js';
import { EtablissementController } from './etablissement.controller.js';
import { EtablissementService } from './etablissement.service.js';

/**
 * Importe `CalendrierModule` pour le seul `CalendrierService.poserRegimeFeries` :
 * le régime de fériés d'un établissement est historisé (`AM-106`) et s'écrit donc
 * dans la **transaction** du CRUD, pas à côté.
 */
@Module({
  imports: [CalendrierModule],
  controllers: [EtablissementController],
  providers: [EtablissementService],
})
export class EtablissementModule {}
