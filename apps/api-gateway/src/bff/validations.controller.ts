import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  NotificationsClient,
  type BrouillonVue,
  type EnvoiResultat,
  type NotificationAValiderVue,
  type ValidationResultat,
} from '../clients/notifications.client.js';
import { valider } from './bff.dto.js';
import { relayer } from './relais.js';

/**
 * Corps minimal de la demande d'envoi (`POST …/envois`). La forme fine (UUID, semaine
 * ISO) est revalidée par le service amont ; ici on s'assure des champs requis.
 */
const envoiSchema = z.object({
  contratId: z.string().min(1),
  semaineIso: z.string().min(1),
});

/**
 * Façade BFF `/api/v1/notifications` : validation hebdomadaire du planning (Lot 4).
 * Agrège `svc-notifications`. Lecture des semaines à valider d'un foyer (indicateur
 * in-app) et validation d'une semaine. La forme fine des paramètres (UUID, semaine
 * ISO) est revalidée par le service amont ; ici on vérifie la présence du `foyer`.
 */
@Controller({ path: 'notifications', version: '1' })
export class ValidationsController {
  constructor(private readonly notifications: NotificationsClient) {}

  /** Liste les semaines à valider d'un foyer : `?foyer=<uuid>`. */
  @Get('a-valider')
  aValider(@Query('foyer') foyer?: string): Promise<NotificationAValiderVue[]> {
    if (!foyer) {
      throw new BadRequestException([
        { champ: 'foyer', message: 'paramètre « foyer » requis' },
      ]);
    }
    return relayer(() => this.notifications.listerAValider(foyer));
  }

  /** Valide la semaine `:semaineIso` du contrat `:contratId`. */
  @Post('validations/:contratId/:semaineIso')
  valider(
    @Param('contratId') contratId: string,
    @Param('semaineIso') semaineIso: string,
  ): Promise<ValidationResultat> {
    return relayer(() =>
      this.notifications.validerSemaine(contratId, semaineIso),
    );
  }

  /** Régénère le brouillon de mail au service (relecture avant envoi, Lot 6). */
  @Get('validations/:contratId/:semaineIso/brouillon')
  brouillon(
    @Param('contratId') contratId: string,
    @Param('semaineIso') semaineIso: string,
  ): Promise<BrouillonVue> {
    return relayer(() =>
      this.notifications.lireBrouillon(contratId, semaineIso),
    );
  }

  /** Envoie réellement le récap au service (après relecture, Lot 6). Idempotent. */
  @Post('envois')
  envoyer(@Body() corps: unknown): Promise<EnvoiResultat> {
    const { contratId, semaineIso } = valider(envoiSchema, corps);
    return relayer(() =>
      this.notifications.envoyerRecap(contratId, semaineIso),
    );
  }
}
