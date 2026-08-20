import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LocationInterceptor } from './location.interceptor.js';
import { CalendrierFoyerController } from './calendrier-foyer.controller.js';
import { ContratsController } from './contrats.controller.js';
import { CoutsController } from './couts.controller.js';
import { DesabonnementController } from './desabonnement.controller.js';
import { EtablissementsFoyerController } from './etablissements-foyer.controller.js';
import { FoyersController } from './foyers.controller.js';
import { MoiController } from './moi.controller.js';
import { ReferentielBffController } from './referentiel.controller.js';
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
    // Calendrier d'ouverture d'un établissement (SFD 31, lot 2). Contrôleur
    // distinct du CRUD établissement : même préfixe de chemin, mais un cycle de
    // vie et un contrat propres — celui de la lecture résolue est gelé.
    CalendrierFoyerController,
    ValidationsController,
    ReferentielBffController,
  ],
})
export class BffModule {}
