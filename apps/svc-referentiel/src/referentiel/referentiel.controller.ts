import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ReferentielService,
  type GrilleApplicable,
  type JourNonFacturableVue,
} from './referentiel.service.js';

/**
 * Date ISO `YYYY-MM-DD` **calendaire réelle** (AQ-04, doc 27) : `z.iso.date()`
 * valide mois 01-12, jour selon le mois et années bissextiles — là où l'ancienne
 * regex `^\d{4}-\d{2}-\d{2}$` acceptait `2026-13-45`.
 */
const dateIsoSchema = z.iso.date();

@Controller()
export class ReferentielController {
  constructor(private readonly referentiel: ReferentielService) {}

  /** Grille/barème applicable à `(date, tranche, mode)` — cœur de la DoD Phase 4. */
  @Get('grilles/applicable')
  grilleApplicable(
    @Query('date') date?: string,
    @Query('mode') mode?: string,
    @Query('tranche') tranche?: string,
  ): Promise<GrilleApplicable> {
    const dateOk = this.exigerDate(date);
    if (mode === undefined || mode === '') {
      throw new BadRequestException('paramètre « mode » requis');
    }
    const trancheNum =
      tranche === undefined || tranche === '' ? undefined : Number(tranche);
    return this.referentiel.grilleApplicable(dateOk, mode, trancheNum);
  }

  /** Jours non facturables (fériés/fermetures/vacances). */
  @Get('calendrier/jours-non-facturables')
  joursNonFacturables(): Promise<JourNonFacturableVue[]> {
    return this.referentiel.listerJoursNonFacturables();
  }

  private exigerDate(date: string | undefined): string {
    if (date === undefined || !dateIsoSchema.safeParse(date).success) {
      throw new BadRequestException(
        'paramètre « date » requis au format YYYY-MM-DD (date calendaire valide)',
      );
    }
    return date;
  }
}
