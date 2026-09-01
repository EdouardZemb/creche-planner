import { Module } from '@nestjs/common';
import { CLOCK, horlogeSysteme } from '@creche-planner/nest-commons';
import { JournalAuditService } from '../audit/journal-audit.service.js';
import { PortabiliteService } from '../portabilite/portabilite.service.js';
import { PortabiliteController } from '../portabilite/portabilite.controller.js';
import { UnitesAssociativesController } from './unites-associatives.controller.js';
import { UnitesAssociativesService } from './unites-associatives.service.js';

/**
 * Suivi des unités associatives (SFD 40) — la première **saisie** de ce service,
 * et donc la première piste d'audit acteur qu'il ait eu à tenir (`RM-40-08`).
 *
 * L'horloge est **injectée** (`CLOCK`) : les trois compteurs trient les sessions
 * par rapport au jour courant (« réservé » vs « à confirmer »), et l'échéance se
 * compte en jours. Un `new Date()` en dur rendrait ces deux frontières intestables.
 */
@Module({
  controllers: [UnitesAssociativesController, PortabiliteController],
  providers: [
    UnitesAssociativesService,
    JournalAuditService,
    PortabiliteService,
    { provide: CLOCK, useValue: horlogeSysteme },
  ],
})
// `no-extraneous-class` : un module Nest EST une classe vide décorée — c'est le
// point d'ancrage des métadonnées de `@Module`, pas un oubli de contenu. La
// désactivation est locale et motivée, plutôt qu'un warning de plus au ratchet.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UnitesAssociativesModule {}
