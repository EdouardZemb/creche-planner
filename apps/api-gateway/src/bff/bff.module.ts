import { Module } from '@nestjs/common';
import { ContratsController } from './contrats.controller.js';
import { CoutsController } from './couts.controller.js';
import { FoyersController } from './foyers.controller.js';

/**
 * Module BFF : contrôleurs d'agrégation orientés écran (`/api/v1/*`). Les clients
 * REST résilients sont fournis globalement par `ClientsModule`.
 */
@Module({
  controllers: [FoyersController, ContratsController, CoutsController],
})
export class BffModule {}
