import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  SemaineIsoPipe,
  ZodValidationPipe,
} from '../validation/validation.dto.js';
import {
  envoiEtablissementSchema,
  type EnvoiEtablissementDto,
} from './envoi.dto.js';
import type {
  BrouillonEtablissementVue,
  EnvoiEtablissementResultat,
} from './envoi.dto.js';
import { EnvoiService } from './envoi.service.js';

/**
 * Mail de récapitulatif **agrégé par établissement** (édition hebdo, Phase 4) — l'action
 * sortante réelle, encadrée par une **relecture humaine**. Granularité : **un seul mail
 * par établissement** regroupant tous les enfants du foyer dont la semaine a été validée
 * avec modifications (remplace l'envoi par-contrat du Lot 6). Deux endpoints :
 *
 * - `GET /validations/semaine/:foyerId/:semaineIso/etablissements/:etablissementId/brouillon` :
 *   régénère le brouillon agrégé (lecture seule) pour la relecture avant envoi ;
 * - `POST /envois/etablissement` : déclenche l'envoi réel **après** le clic « Envoyer »
 *   (idempotent via la clé d'unicité `(foyer, semaine, établissement)`, garde-fous
 *   dry-run/allowlist du mailer).
 *
 * La forme des paramètres (UUID foyer/établissement, semaine ISO, corps) est vérifiée
 * par des pipes ; l'agrégation, l'idempotence et le journal vivent dans le service.
 */
@Controller()
export class EnvoiController {
  constructor(private readonly envois: EnvoiService) {}

  /** Régénère le brouillon agrégé du mail de service pour relecture (lecture seule). */
  @Get(
    'validations/semaine/:foyerId/:semaineIso/etablissements/:etablissementId/brouillon',
  )
  brouillon(
    @Param('foyerId', ParseUUIDPipe) foyerId: string,
    @Param('semaineIso', SemaineIsoPipe) semaineIso: string,
    @Param('etablissementId', ParseUUIDPipe) etablissementId: string,
  ): Promise<BrouillonEtablissementVue> {
    return this.envois.brouillon(foyerId, semaineIso, etablissementId);
  }

  /** Envoie réellement le récap agrégé au service (après relecture). Idempotent. */
  @Post('envois/etablissement')
  @HttpCode(HttpStatus.OK)
  envoyer(
    @Body(new ZodValidationPipe(envoiEtablissementSchema))
    dto: EnvoiEtablissementDto,
  ): Promise<EnvoiEtablissementResultat> {
    return this.envois.envoyer(
      dto.foyerId,
      dto.semaineIso,
      dto.etablissementId,
    );
  }
}
