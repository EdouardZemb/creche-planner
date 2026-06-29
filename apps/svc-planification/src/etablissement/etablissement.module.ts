import { Module } from '@nestjs/common';
import { EtablissementController } from './etablissement.controller.js';
import { EtablissementService } from './etablissement.service.js';

@Module({
  controllers: [EtablissementController],
  providers: [EtablissementService],
})
export class EtablissementModule {}
