import { Module } from '@nestjs/common';
import { PlanificationClient } from '../fallback/planification.client.js';
import { ValidationController } from './validation.controller.js';
import { ValidationService } from './validation.service.js';

/**
 * Module **validation hebdomadaire** (Lot 4) : état des semaines à valider du
 * planning, diff snapshot↔relecture et indicateur in-app. Le client Drizzle est
 * fourni par le module global `DatabaseModule` ; le client de relecture du planning
 * (`PlanificationClient`) est déclaré ici. Le service est exporté pour le scheduler
 * du mardi (Lot 5), qui appellera `notifier`.
 */
@Module({
  controllers: [ValidationController],
  providers: [ValidationService, PlanificationClient],
  exports: [ValidationService],
})
export class ValidationModule {}
