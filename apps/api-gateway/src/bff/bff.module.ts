import { Module } from '@nestjs/common';
import { ContratsController } from './contrats.controller.js';
import { CoutsController } from './couts.controller.js';
import { EtablissementsFoyerController } from './etablissements-foyer.controller.js';
import { FoyersController } from './foyers.controller.js';
import { MoiController } from './moi.controller.js';
import { ValidationsController } from './validations.controller.js';

/**
 * Module BFF : contrôleurs d'agrégation orientés écran (`/api/v1/*`). Les clients
 * REST résilients sont fournis globalement par `ClientsModule`.
 */
@Module({
  controllers: [
    FoyersController,
    MoiController,
    ContratsController,
    CoutsController,
    EtablissementsFoyerController,
    ValidationsController,
  ],
})
export class BffModule {}
