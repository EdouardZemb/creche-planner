import { Module } from '@nestjs/common';
import { PortabiliteController } from './portabilite.controller.js';
import { PortabiliteService } from './portabilite.service.js';

/* eslint-disable @typescript-eslint/no-extraneous-class -- un module Nest EST une
   classe sans membre : c'est le support des métadonnées `@Module`, pas un espace de
   noms déguisé. Faux positif structurel de la famille tranchée par le lot D7 (b) ;
   désactivé ici pour ne pas faire monter la baseline `lint-baseline.json`. La
   directive porte sur le DÉCORATEUR autant que sur la classe — un
   `disable-next-line` posé entre les deux ne s'applique pas (le nœud signalé
   commence à `@Module`) et compte alors comme directive inutilisée. */
@Module({
  controllers: [PortabiliteController],
  providers: [PortabiliteService],
})
export class PortabiliteModule {}
