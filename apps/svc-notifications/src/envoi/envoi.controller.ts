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
import { ZodValidationPipe } from '../etablissement/etablissement.dto.js';
import { SemaineIsoPipe } from '../validation/validation.dto.js';
import { envoiSchema, type EnvoiDto } from './envoi.dto.js';
import type { BrouillonVue, EnvoiResultat } from './envoi.dto.js';
import { EnvoiService } from './envoi.service.js';

/**
 * Mail de récapitulatif au **service** concerné (Lot 6) — l'action sortante réelle,
 * encadrée par une **relecture humaine**. Deux endpoints :
 *
 * - `GET /validations/:contratId/:semaineIso/brouillon` : régénère le brouillon
 *   (lecture seule, ré-générable) pour la relecture avant envoi ;
 * - `POST /envois` : déclenche l'envoi réel **après** le clic « Envoyer » (idempotent
 *   via la clé d'unicité d'`envoi_mail`, garde-fous dry-run/allowlist du mailer).
 *
 * La forme des paramètres (UUID, semaine ISO, corps) est vérifiée par des pipes ; la
 * résolution du destinataire, l'idempotence et le journal vivent dans le service.
 */
@Controller()
export class EnvoiController {
  constructor(private readonly envois: EnvoiService) {}

  /** Régénère le brouillon du mail de service pour relecture (lecture seule). */
  @Get('validations/:contratId/:semaineIso/brouillon')
  brouillon(
    @Param('contratId', ParseUUIDPipe) contratId: string,
    @Param('semaineIso', SemaineIsoPipe) semaineIso: string,
  ): Promise<BrouillonVue> {
    return this.envois.brouillon(contratId, semaineIso);
  }

  /** Envoie réellement le récap au service (après relecture). Idempotent. */
  @Post('envois')
  @HttpCode(HttpStatus.OK)
  envoyer(
    @Body(new ZodValidationPipe(envoiSchema)) dto: EnvoiDto,
  ): Promise<EnvoiResultat> {
    return this.envois.envoyer(dto.contratId, dto.semaineIso);
  }
}
