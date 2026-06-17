import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  CoutService,
  type CoutAnnuelVue,
  type CoutMoisVue,
} from './cout.service.js';

// Mois borné 01-12 (AQ-04, doc 27 : l'ancienne `\d{2}` acceptait « 2026-13 »).
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
  @Get()
  coutMois(
    @Query('foyer') foyerId?: string,
    @Query('mois') mois?: string,
    @Query('simule') simule?: string,
  ): Promise<CoutMoisVue> {
    return this.couts.coutMois(
      this.exigerFoyer(foyerId),
      this.exigerMois(mois),
      simule === 'true',
    );
  }

  /** Coût annuel d'un foyer : `?foyer=&annee=YYYY&simule=`. */
  @Get('annuel')
  coutAnnuel(
    @Query('foyer') foyerId?: string,
    @Query('annee') annee?: string,
    @Query('simule') simule?: string,
  ): Promise<CoutAnnuelVue> {
    return this.couts.coutAnnuel(
      this.exigerFoyer(foyerId),
      this.exigerAnnee(annee),
      simule === 'true',
    );
  }

  private exigerFoyer(foyerId: string | undefined): string {
    if (foyerId === undefined || !UUID.test(foyerId)) {
      throw new BadRequestException('paramètre « foyer » requis (UUID)');
    }
    return foyerId;
  }

  private exigerMois(mois: string | undefined): string {
    if (mois === undefined || !ISO_MOIS.test(mois)) {
      throw new BadRequestException(
        'paramètre « mois » requis au format YYYY-MM',
      );
    }
    return mois;
  }

  private exigerAnnee(annee: string | undefined): number {
    if (annee === undefined || !ANNEE.test(annee)) {
      throw new BadRequestException(
        'paramètre « annee » requis au format YYYY',
      );
    }
    return Number(annee);
  }
}
