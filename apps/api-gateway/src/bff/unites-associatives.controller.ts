import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  TarificationClient,
  type EngagementUaVue,
  type SessionUaVue,
  type SuiviUaVue,
} from '../clients/tarification.client.js';
import { valider } from './bff.dto.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import { relayer } from './relais.js';

/**
 * Formes minimales acceptées à la frontière BFF. La validation profonde (période
 * qui chevauche, date hors période, catalogue de types) reste chez
 * `svc-tarification`, qui seule connaît l'état du foyer — ici on refuse ce qui
 * n'a pas la bonne **forme**, et on relaie.
 */
const declarerEngagementSchema = z.object({
  debut: z.iso.date('date ISO YYYY-MM-DD attendue'),
  fin: z.iso.date('date ISO YYYY-MM-DD attendue'),
  quotaHeures: z.number().nonnegative(),
  valeurUaCentimes: z.number().int().nonnegative(),
  cautionCentimes: z.number().int().nonnegative().optional(),
});

const ajouterSessionSchema = z.object({
  engagementId: z.uuid(),
  date: z.iso.date('date ISO YYYY-MM-DD attendue'),
  dureeHeures: z.number().positive(),
  type: z.string().min(1).max(32),
  realisePar: z.string().min(1).max(200).optional(),
  etablissementId: z.uuid().optional(),
});

const modifierSessionSchema = z.object({
  etat: z.enum(['PREVUE', 'REALISEE', 'ANNULEE']).optional(),
  date: z.iso.date('date ISO YYYY-MM-DD attendue').optional(),
  dureeHeures: z.number().positive().optional(),
  type: z.string().min(1).max(32).optional(),
  realisePar: z.string().min(1).max(200).optional(),
});

/**
 * Façade BFF `/api/v1/unites-associatives` : relaie `svc-tarification` pour le
 * **suivi** de l'engagement de bénévolat du foyer (SFD 40).
 *
 * **Martha ne réserve rien** (`RM-40-01`). Les créneaux se prennent sur le site
 * travaux de l'association ; ces routes tiennent le compte de ce qui a été pris et
 * de ce qui a été fait. Aucune d'elles n'appelle un système tiers.
 */
@Controller({ path: 'unites-associatives', version: '1' })
export class UnitesAssociativesController {
  constructor(private readonly tarification: TarificationClient) {}

  /** Suivi complet : engagement courant, sessions, trois compteurs, échéance. */
  @Get()
  @FoyerScope('query:foyer')
  suivi(@Query('foyer') foyer: string | undefined): Promise<SuiviUaVue> {
    // `exigerFoyer` est appelé HORS de `relayer` : à l'intérieur, sa 400 serait
    // traduite en 502 « erreur du service amont » — un défaut de saisie du client
    // deviendrait une panne de la passerelle.
    const foyerId = exigerFoyer(foyer);
    return relayer(() => this.tarification.suiviUnitesAssociatives(foyerId));
  }

  /** Déclare l'engagement de la période (quota, valeur d'UA, dates, caution). */
  @Post()
  @FoyerScope('query:foyer')
  declarer(
    @Query('foyer') foyer: string | undefined,
    @Body() corps: unknown,
  ): Promise<EngagementUaVue> {
    const foyerId = exigerFoyer(foyer);
    const saisie = valider(declarerEngagementSchema, corps);
    return relayer(() =>
      this.tarification.declarerEngagementUa(foyerId, saisie),
    );
  }

  /** Note un créneau pris sur le site travaux (créé à l'état `PREVUE`). */
  @Post('sessions')
  @FoyerScope('query:foyer')
  ajouterSession(
    @Query('foyer') foyer: string | undefined,
    @Body() corps: unknown,
  ): Promise<SessionUaVue> {
    const foyerId = exigerFoyer(foyer);
    const saisie = valider(ajouterSessionSchema, corps);
    return relayer(() => this.tarification.ajouterSessionUa(foyerId, saisie));
  }

  /** Marque une session réalisée ou annulée, ou en corrige les champs. */
  @Put('sessions/:sessionId')
  @FoyerScope('query:foyer')
  modifierSession(
    @Param('sessionId') sessionId: string,
    @Query('foyer') foyer: string | undefined,
    @Body() corps: unknown,
  ): Promise<SessionUaVue> {
    const foyerId = exigerFoyer(foyer);
    const saisie = valider(modifierSessionSchema, corps);
    return relayer(() =>
      this.tarification.modifierSessionUa(foyerId, sessionId, saisie),
    );
  }

  /** Supprime une session saisie par erreur (≠ l'annuler, qui garde la trace). */
  @Delete('sessions/:sessionId')
  @FoyerScope('query:foyer')
  @HttpCode(HttpStatus.NO_CONTENT)
  supprimerSession(
    @Param('sessionId') sessionId: string,
    @Query('foyer') foyer: string | undefined,
  ): Promise<void> {
    const foyerId = exigerFoyer(foyer);
    return relayer(() =>
      this.tarification.supprimerSessionUa(foyerId, sessionId),
    );
  }
}

function exigerFoyer(foyer: string | undefined): string {
  if (!foyer) {
    throw new BadRequestException('paramètre « foyer » requis');
  }
  return foyer;
}
