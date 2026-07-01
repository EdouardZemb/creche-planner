import { Module } from '@nestjs/common';
import { loadConfig } from '../config.js';
import { DesabonnementController } from './desabonnement.controller.js';
import { DesabonnementService } from './desabonnement.service.js';
import {
  OPTIONS_DESABONNEMENT,
  type OptionsDesabonnement,
} from './desabonnement.options.js';
import { FoyerController } from './foyer.controller.js';
import { FoyerService } from './foyer.service.js';

@Module({
  controllers: [FoyerController, DesabonnementController],
  providers: [
    FoyerService,
    DesabonnementService,
    {
      provide: OPTIONS_DESABONNEMENT,
      useFactory: (): OptionsDesabonnement => {
        const { desabonnement } = loadConfig();
        return {
          secret: desabonnement.secret,
          ttlJours: desabonnement.ttlJours,
        };
      },
    },
  ],
})
export class FoyerModule {}
