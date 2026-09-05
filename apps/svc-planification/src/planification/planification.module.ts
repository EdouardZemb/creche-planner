import { Module } from '@nestjs/common';
import { CLOCK, horlogeSysteme } from '@creche-planner/nest-commons';
import { CalendrierModule } from '../calendrier/calendrier.module.js';
import { PlanificationController } from './planification.controller.js';
import { PlanificationService } from './planification.service.js';

/**
 * Planification des contrats et des plannings.
 *
 * Depuis le lot 4 de la SFD 31, ce module **importe `CalendrierModule`** : les
 * jours non facturables ne viennent plus d'un appel HTTP dégradable au
 * Référentiel mais du calendrier d'ouverture de l'établissement, lu dans la base
 * locale (RM-31-04). C'est la fin de la dernière dépendance sortante du chemin de
 * génération — et du repli silencieux en liste vide qui l'accompagnait.
 *
 * L'horloge est injectée plutôt que lue en dur : la génération a besoin d'un
 * « maintenant » pour l'axe de connaissance (RM-31-03), et un test qui ne peut pas
 * déplacer cet instant ne peut pas prouver qu'une retouche d'aujourd'hui laisse
 * un mois arrêté hier intact.
 */
/* eslint-disable @typescript-eslint/no-extraneous-class -- un module Nest EST une
   classe sans membre : c'est le support des métadonnées `@Module`, pas un espace de
   noms déguisé. Faux positif structurel connu du dépôt (cf. `calendrier.module.ts`) ;
   désactivé ici pour ne pas faire monter la baseline `lint-baseline.json`. */
@Module({
  imports: [CalendrierModule],
  controllers: [PlanificationController],
  providers: [
    PlanificationService,
    { provide: CLOCK, useValue: horlogeSysteme },
  ],
})
export class PlanificationModule {}
