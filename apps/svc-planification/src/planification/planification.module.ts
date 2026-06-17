import { Module } from '@nestjs/common';
import { PlanificationController } from './planification.controller.js';
import { PlanificationService } from './planification.service.js';
import { ReferentielClient } from './referentiel.client.js';

@Module({
  controllers: [PlanificationController],
  providers: [PlanificationService, ReferentielClient],
})
export class PlanificationModule {}
