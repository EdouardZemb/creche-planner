import { Module } from '@nestjs/common';
import { ErreursClientController } from './erreurs-client.controller.js';

/**
 * Observabilité côté client : la gateway sert de point de collecte même-origine
 * aux plantages du navigateur (lot C7). Séparé du `BffModule` à dessein — ce
 * n'est pas une façade d'agrégation orientée écran mais un puits de journal, sans
 * aucun client REST amont.
 */
/* eslint-disable @typescript-eslint/no-extraneous-class -- un module Nest EST une
   classe sans membre : c'est le support des métadonnées `@Module`, pas un espace de
   noms déguisé. Faux positif structurel (45 autres occurrences dans le dépôt, que
   le lot D7 (b) doit trancher en famille) ; désactivé ici pour ne pas faire monter
   la baseline `lint-baseline.json` d'un warning connu. La directive porte sur le
   DÉCORATEUR autant que sur la classe — un `disable-next-line` posé entre les deux
   ne s'applique pas (le nœud signalé commence à `@Module`) et compte alors comme
   directive inutilisée. */
@Module({
  controllers: [ErreursClientController],
})
export class ObservabiliteModule {}
