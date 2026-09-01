import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ActeurCourant,
  ScopeFoyerInterServices,
  type Acteur,
} from '@creche-planner/nest-commons';
import {
  UnitesAssociativesService,
  type EngagementUaVue,
  type SessionUaVue,
  type SuiviUaVue,
} from './unites-associatives.service.js';
import {
  ZodValidationPipe,
  ajouterSessionSchema,
  declarerEngagementSchema,
  modifierSessionSchema,
  type AjouterSessionDto,
  type DeclarerEngagementDto,
  type ModifierSessionDto,
} from './unites-associatives.dto.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * API « unités associatives » (préfixe `/api`, SFD 40). Toutes les routes portent
 * le foyer en **paramètre de requête** `?foyer=` — y compris celles qui visent une
 * session par son identifiant : c'est ce qui permet au `ScopeFoyerGuard` de trancher
 * sans résolveur en base (`AssertionIdentiteModule.forRoot({ scoping: {} })`), et
 * au service de borner la ressource au foyer ainsi validé.
 *
 * **Martha ne réserve rien** (`RM-40-01`) : ces routes tiennent le compte de
 * créneaux pris sur le site travaux de l'association, elles n'en prennent aucun.
 */
@Controller('unites-associatives')
export class UnitesAssociativesController {
  constructor(private readonly ua: UnitesAssociativesService) {}

  /** Suivi d'un foyer : engagement courant, sessions et les trois compteurs. */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Get()
  suivi(@Query('foyer') foyerId?: unknown): Promise<SuiviUaVue> {
    return this.ua.suivi(exigerFoyer(foyerId));
  }

  /** Déclare l'engagement d'une période (quota, valeur d'UA, dates, caution). */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Post()
  declarer(
    @Body(new ZodValidationPipe(declarerEngagementSchema))
    dto: DeclarerEngagementDto,
    @ActeurCourant() acteur: Acteur,
    @Query('foyer') foyerId?: unknown,
  ): Promise<EngagementUaVue> {
    return this.ua.declarerEngagement(exigerFoyer(foyerId), dto, acteur);
  }

  /** Note un créneau pris sur le site travaux (état initial : `PREVUE`). */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Post('sessions')
  ajouterSession(
    @Body(new ZodValidationPipe(ajouterSessionSchema)) dto: AjouterSessionDto,
    @ActeurCourant() acteur: Acteur,
    @Query('foyer') foyerId?: unknown,
  ): Promise<SessionUaVue> {
    return this.ua.ajouterSession(exigerFoyer(foyerId), dto, acteur);
  }

  /** Marque une session réalisée ou annulée, ou en corrige les champs. */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Put('sessions/:sessionId')
  modifierSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body(new ZodValidationPipe(modifierSessionSchema)) dto: ModifierSessionDto,
    @ActeurCourant() acteur: Acteur,
    @Query('foyer') foyerId?: unknown,
  ): Promise<SessionUaVue> {
    return this.ua.modifierSession(
      exigerFoyer(foyerId),
      sessionId,
      dto,
      acteur,
    );
  }

  /** Supprime une session saisie par erreur (≠ l'annuler, qui garde la trace). */
  @ScopeFoyerInterServices({ query: 'foyer' })
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  supprimerSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @ActeurCourant() acteur: Acteur,
    @Query('foyer') foyerId?: unknown,
  ): Promise<void> {
    return this.ua.supprimerSession(exigerFoyer(foyerId), sessionId, acteur);
  }
}

/**
 * Garde `typeof === 'string'` AVANT la regex, et paramètre typé `unknown` : Express
 * parse `?foyer[]=…` en TABLEAU, et `RegExp.test` stringifie son argument — même
 * confusion de type que celle corrigée sur `/couts` (CodeQL
 * `js/type-confusion-through-parameter-tampering`).
 */
function exigerFoyer(foyerId: unknown): string {
  if (typeof foyerId !== 'string' || !UUID.test(foyerId)) {
    throw new BadRequestException('paramètre « foyer » requis (UUID)');
  }
  return foyerId;
}
