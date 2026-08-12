import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
import {
  PortabiliteService,
  type ExportPlanificationVue,
} from './portabilite.service.js';

/**
 * Export de portabilité de la part `svc-planification` d'un foyer (lot 3).
 * Route rattachée au **foyer** — et non aux contrats — parce que c'est le foyer
 * qui est la personne concernée : le scoping `:foyerId ∈ assertion.foyers` est
 * alors direct, sans résolution en base.
 */
@Controller('foyers')
export class PortabiliteController {
  constructor(private readonly portabilite: PortabiliteService) {}

  @ScopeFoyerInterServices({ param: 'foyerId' })
  @Get(':foyerId/export')
  exporter(
    @Param('foyerId', ParseUUIDPipe) foyerId: string,
  ): Promise<ExportPlanificationVue> {
    return this.portabilite.exporter(foyerId);
  }
}
