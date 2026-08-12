import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ProblemeFilter } from './probleme.filter.js';

/**
 * Format d'erreur unique de la passerelle (RFC 9457, `AM-37`). La passerelle
 * n'avait **aucun** filtre global : chaque route rendait la forme d'erreur de la
 * couche qui l'avait levée. Le filtre est câblé en `APP_FILTER` — donc résolu
 * par l'injection, ce qui lui donne le `Reflector` dont il a besoin pour lire
 * l'exemption `@FormatErreurNatif()` (un `useGlobalFilters(new …)` dans
 * `main.ts` ne l'aurait pas).
 */
/* eslint-disable @typescript-eslint/no-extraneous-class -- un module Nest EST une
   classe sans membre : c'est le support des métadonnées `@Module`, pas un espace de
   noms déguisé. Faux positif structurel connu (cf. `observabilite.module.ts`) ;
   désactivé ici pour ne pas faire monter la baseline `lint-baseline.json`. La
   directive porte sur le DÉCORATEUR autant que sur la classe — un
   `disable-next-line` posé entre les deux ne s'applique pas. */
@Module({
  providers: [{ provide: APP_FILTER, useClass: ProblemeFilter }],
})
export class ErreursModule {}
