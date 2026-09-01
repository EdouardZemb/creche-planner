import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
import {
  PortabiliteService,
  type ExportUnitesAssociativesVue,
} from './portabilite.service.js';

/**
 * Part `svc-tarification` de l'export de portabilité (doc 37 §6), agrégée par la
 * passerelle dans `GET /api/v1/foyers/{id}/export`. Lecture seule, scopée au foyer.
 */
@Controller('foyers')
export class PortabiliteController {
  constructor(private readonly portabilite: PortabiliteService) {}

  @ScopeFoyerInterServices({ param: 'id' })
  @Get(':id/export')
  exporter(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExportUnitesAssociativesVue> {
    return this.portabilite.exporter(id);
  }
}
