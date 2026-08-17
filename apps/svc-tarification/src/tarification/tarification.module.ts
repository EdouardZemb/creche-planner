import { Module } from '@nestjs/common';
import { CLOCK, horlogeSysteme } from '@creche-planner/nest-commons';
import { CoutController } from './cout.controller.js';
import { CoutService } from './cout.service.js';

/**
 * API « coût du mois/an » : valorise le read model via le domaine tarifaire.
 *
 * L'horloge est **injectée** (`CLOCK`) : le calcul distingue un mois passé d'un mois
 * courant pour décider si la ligne « courante » d'un foyer sans historique versionné
 * a le droit de le valoriser (`AM-55`). Une lecture de `new Date()` en dur rendrait
 * cette frontière intestable.
 */
@Module({
  controllers: [CoutController],
  providers: [CoutService, { provide: CLOCK, useValue: horlogeSysteme }],
})
export class TarificationModule {}
