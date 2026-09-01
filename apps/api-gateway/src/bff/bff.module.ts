import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LocationInterceptor } from './location.interceptor.js';
import { ContratsController } from './contrats.controller.js';
import { CoutsController } from './couts.controller.js';
import { DesabonnementController } from './desabonnement.controller.js';
import { EtablissementsFoyerController } from './etablissements-foyer.controller.js';
import { FoyersController } from './foyers.controller.js';
import { MoiController } from './moi.controller.js';
import { ReferentielBffController } from './referentiel.controller.js';
import { UnitesAssociativesController } from './unites-associatives.controller.js';
import { ValidationsController } from './validations.controller.js';

/**
 * Module BFF : contrôleurs d'agrégation orientés écran (`/api/v1/*`). Les clients
 * REST résilients sont fournis globalement par `ClientsModule`.
 *
 * `LocationInterceptor` est câblé en `APP_INTERCEPTOR` — donc résolu par
 * l'injection, ce qui lui donne le `Reflector` dont il a besoin pour lire
 * `@RessourceCreee` (même raison qu'`APP_FILTER` pour `ProblemeFilter`). Il est
 * inerte sur toute route qui ne porte pas le décorateur.
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: LocationInterceptor }],
  controllers: [
    FoyersController,
    MoiController,
    ContratsController,
    CoutsController,
    DesabonnementController,
    EtablissementsFoyerController,
    ValidationsController,
    ReferentielBffController,
    UnitesAssociativesController,
  ],
})
export class BffModule {}
