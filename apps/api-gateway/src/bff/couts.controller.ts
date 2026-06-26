import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  TarificationClient,
  type CoutAnnuelVue,
  type CoutMoisVue,
} from '../clients/tarification.client.js';
import { moisSchema, valider } from './bff.dto.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/couts` : relaie `svc-tarification` (coût consolidé du mois
 * et de l'année — détail par enfant/mode, transition crèche → école).
 */
@Controller({ path: 'couts', version: '1' })
export class CoutsController {
  constructor(private readonly tarification: TarificationClient) {}

  /** Coût consolidé d'un mois pour un foyer. */
  @Get()
  @FoyerScope('query:foyer')
  cout(
    @Query('foyer') foyer: string | undefined,
    @Query('mois') mois: string | undefined,
    @Query('simule') simule: string | undefined,
  ): Promise<CoutMoisVue> {
    if (!foyer) {
      throw new BadRequestException('paramètre « foyer » requis');
    }
    valider(moisSchema, mois);
    return relayer(() =>
      this.tarification.cout(foyer, mois!, simule === 'true'),
    );
  }

  /** Coût consolidé d'une année pour un foyer. */
  @Get('annuel')
  @FoyerScope('query:foyer')
  annuel(
    @Query('foyer') foyer: string | undefined,
    @Query('annee') annee: string | undefined,
    @Query('simule') simule: string | undefined,
  ): Promise<CoutAnnuelVue> {
    if (!foyer) {
      throw new BadRequestException('paramètre « foyer » requis');
    }
    const valeur = Number(annee);
    if (!Number.isInteger(valeur)) {
      throw new BadRequestException(
        'paramètre « annee » invalide (entier attendu)',
      );
    }
    return relayer(() =>
      this.tarification.coutAnnuel(foyer, valeur, simule === 'true'),
    );
  }
}
