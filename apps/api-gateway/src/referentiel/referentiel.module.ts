import { Module } from '@nestjs/common';
import { ReferentielController } from './referentiel.controller.js';

@Module({
  controllers: [ReferentielController],
})
export class ReferentielModule {}
