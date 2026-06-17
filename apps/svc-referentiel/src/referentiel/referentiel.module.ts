import { Module } from '@nestjs/common';
import { ReferentielController } from './referentiel.controller.js';
import { ReferentielService } from './referentiel.service.js';
import { SeedService } from './seed.service.js';

@Module({
  controllers: [ReferentielController],
  providers: [ReferentielService, SeedService],
})
export class ReferentielModule {}
