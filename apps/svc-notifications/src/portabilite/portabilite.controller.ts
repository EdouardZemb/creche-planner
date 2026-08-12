import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
import {
  PortabiliteService,
  type ExportNotificationsVue,
} from './portabilite.service.js';

/**
 * Export de portabilité de la part `svc-notifications` d'un foyer (lot 3).
 * Route rattachée au **foyer** : le scoping `:foyerId ∈ assertion.foyers` est
 * alors direct, sans passer par le résolveur local (contrat → foyer,
 * parent → e-mail) que réclament les routes de validation et d'inbox.
 */
@Controller('foyers')
export class PortabiliteController {
  constructor(private readonly portabilite: PortabiliteService) {}

  @ScopeFoyerInterServices({ param: 'foyerId' })
  @Get(':foyerId/export')
  exporter(
    @Param('foyerId', ParseUUIDPipe) foyerId: string,
  ): Promise<ExportNotificationsVue> {
    return this.portabilite.exporter(foyerId);
  }
}
