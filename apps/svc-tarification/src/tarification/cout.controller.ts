import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
import {
  CoutService,
  type CoutAnnuelVue,
  type CoutMoisVue,
} from './cout.service.js';

// Mois borné 01-12 (AQ-04, doc 27 : l'ancienne `\d{2}` acceptait « 2026-13 »).
//
// Les gardes ci-dessous testent `typeof === 'string'` AVANT la regex, et les
// paramètres de requête sont typés `unknown` : Express parse `?mois[]=2026-09`
// en TABLEAU, et `RegExp.test` stringifie son argument — `['2026-09']` passait
// donc la regex tout en restant un tableau typé `string` en aval, où
// `mois.slice(0, 4)` rend un tableau et `Number(...)` un NaN silencieux (frais
// fixes ABCM de première année jamais facturés). CodeQL
// `js/type-confusion-through-parameter-tampering`, alertes #20/#21.
const ISO_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const ANNEE = /^\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * API « coût du mois/an » (préfixe `/api`, doc 06 §10.4). Lecture seule : valorise
 * les prestations projetées du foyer via le domaine et renvoie les montants en
 * **centimes** (cohérent avec le reste du dépôt). `?simule=true` valorise le
 * planning simulé.
 */
@Controller('couts')
export class CoutController {
  constructor(private readonly couts: CoutService) {}

  /** Coût consolidé d'un foyer pour un mois : `?foyer=&mois=YYYY-MM&simule=`. */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Get()
  coutMois(
    @Query('foyer') foyerId?: unknown,
    @Query('mois') mois?: unknown,
    @Query('simule') simule?: string,
  ): Promise<CoutMoisVue> {
    return this.couts.coutMois(
      this.exigerFoyer(foyerId),
      this.exigerMois(mois),
      simule === 'true',
    );
  }

  /** Coût annuel d'un foyer : `?foyer=&annee=YYYY&simule=`. */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Get('annuel')
  coutAnnuel(
    @Query('foyer') foyerId?: unknown,
    @Query('annee') annee?: unknown,
    @Query('simule') simule?: string,
  ): Promise<CoutAnnuelVue> {
    return this.couts.coutAnnuel(
      this.exigerFoyer(foyerId),
      this.exigerAnnee(annee),
      simule === 'true',
    );
  }

  private exigerFoyer(foyerId: unknown): string {
    if (typeof foyerId !== 'string' || !UUID.test(foyerId)) {
      throw new BadRequestException('paramètre « foyer » requis (UUID)');
    }
    return foyerId;
  }

  private exigerMois(mois: unknown): string {
    if (typeof mois !== 'string' || !ISO_MOIS.test(mois)) {
      throw new BadRequestException(
        'paramètre « mois » requis au format YYYY-MM',
      );
    }
    return mois;
  }

  private exigerAnnee(annee: unknown): number {
    if (typeof annee !== 'string' || !ANNEE.test(annee)) {
      throw new BadRequestException(
        'paramètre « annee » requis au format YYYY',
      );
    }
    return Number(annee);
  }
}
