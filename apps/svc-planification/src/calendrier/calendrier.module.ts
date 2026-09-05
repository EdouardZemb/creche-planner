import { Module } from '@nestjs/common';
import { CLOCK, horlogeSysteme } from '@creche-planner/nest-commons';
import { CalendrierController } from './calendrier.controller.js';
import { CalendrierImportService } from './calendrier-import.service.js';
import { CalendrierService } from './calendrier.service.js';

/**
 * Calendrier d'ouverture des établissements (SFD 31, lot 2).
 *
 * `CalendrierService` est **exporté** : le CRUD établissement s'en sert pour poser
 * le régime de fériés sur l'axe de connaissance (`AM-106`) dans sa propre
 * transaction. C'est le seul couplage sortant, et il est délibéré — un régime
 * écrit hors de la transaction qui crée l'établissement se retrouverait absent au
 * premier crash entre les deux.
 *
 * L'horloge est injectée (`CLOCK`) et non lue en dur : le domaine ignore quel jour
 * on est, c'est ce service qui le lui dit — et les tests poussent l'instant qu'ils
 * veulent, ce qui est la seule façon de prouver qu'une retouche d'aujourd'hui ne
 * change pas la réponse d'hier.
 */
/* eslint-disable @typescript-eslint/no-extraneous-class -- un module Nest EST une
   classe sans membre : c'est le support des métadonnées `@Module`, pas un espace de
   noms déguisé. Faux positif structurel connu du dépôt (cf. `observabilite.module.ts`) ;
   désactivé ici pour ne pas faire monter la baseline `lint-baseline.json`. La
   directive porte sur le DÉCORATEUR autant que sur la classe — un `disable-next-line`
   posé entre les deux ne s'applique pas (le nœud signalé commence à `@Module`). */
@Module({
  controllers: [CalendrierController],
  providers: [
    CalendrierService,
    CalendrierImportService,
    { provide: CLOCK, useValue: horlogeSysteme },
  ],
  exports: [CalendrierService],
})
export class CalendrierModule {}
