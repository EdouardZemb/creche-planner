import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import {
  ReferentielClient,
  type BaremePsuVue,
  type BaremeTranchesVue,
  type GrilleAbcmVue,
} from '../clients/referentiel.client.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/referentiel` : publication du **catalogue tarifaire**
 * (grilles ABCM, barèmes PSU/tranches) depuis l'écran « Tarifs » (SFD 30, lot 6).
 *
 * Le référentiel est **global** (une seule source de vérité pour tout le produit
 * mono-foyer) : ces routes ne portent **pas** de `@FoyerScope` (le scoping par
 * foyer n'aurait pas de sens). Elles restent néanmoins **authentifiées** (le
 * `TokenAuthGuard` gate toute route non `@Public`) et **tracées** (l'assertion
 * d'identité est propagée vers `svc-referentiel` par l'interceptor global). Un
 * chevauchement de période remonté par le service (**409** structuré) est relayé
 * tel quel à l'écran.
 */
@Controller({ path: 'referentiel', version: '1' })
export class ReferentielBffController {
  private readonly logger = new Logger(ReferentielBffController.name);

  constructor(private readonly referentiel: ReferentielClient) {}

  /** GET `/api/v1/referentiel/grilles` — liste des grilles ABCM publiées. */
  @Get('grilles')
  listerGrilles(): Promise<GrilleAbcmVue[]> {
    return relayer(() => this.referentiel.listerGrilles());
  }

  /** POST `/api/v1/referentiel/grilles` — publie une grille complète (201 ; **409** si chevauchement). */
  @Post('grilles')
  publierGrille(@Body() corps: unknown): Promise<GrilleAbcmVue[]> {
    this.logger.log('Publication d’une grille ABCM (écran Tarifs)');
    return relayer(() => this.referentiel.publierGrille(corps));
  }

  /** POST `/api/v1/referentiel/baremes/psu` — publie un barème PSU (201 ; **409**). */
  @Post('baremes/psu')
  publierBaremePsu(@Body() corps: unknown): Promise<BaremePsuVue> {
    this.logger.log('Publication d’un barème PSU (écran Tarifs)');
    return relayer(() => this.referentiel.publierBaremePsu(corps));
  }

  /** POST `/api/v1/referentiel/baremes/tranches` — publie un barème de seuils (201 ; **409**). */
  @Post('baremes/tranches')
  publierBaremeTranches(@Body() corps: unknown): Promise<BaremeTranchesVue> {
    this.logger.log('Publication d’un barème de tranches (écran Tarifs)');
    return relayer(() => this.referentiel.publierBaremeTranches(corps));
  }
}
