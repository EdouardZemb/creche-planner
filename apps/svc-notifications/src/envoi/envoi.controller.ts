import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
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
  SuiviEnvoisVue,
} from './envoi.dto.js';
import { EnvoiService } from './envoi.service.js';
import { SuiviEnvoisService } from './suivi-envois.service.js';

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
 *   dry-run/allowlist du mailer) ;
 * - `GET /validations/semaine/:foyerId/:semaineIso/envois` (B1) : lit, en **lecture
 *   seule**, le statut **persistant** des envois de la semaine (rappel aux parents +
 *   récaps aux établissements) pour le bloc « Suivi des envois » de l'encart.
 *
 * La forme des paramètres (UUID foyer/établissement, semaine ISO, corps) est vérifiée
 * par des pipes ; l'agrégation, l'idempotence et le journal vivent dans le service.
 */
@Controller()
export class EnvoiController {
  constructor(
    private readonly envois: EnvoiService,
    private readonly suivis: SuiviEnvoisService,
  ) {}

  /** Régénère le brouillon agrégé du mail de service pour relecture (lecture seule). */
  @ScopeFoyerInterServices({ param: 'foyerId' })
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

  /**
   * Suivi des envois de la semaine (B1, **lecture seule**) : statut persistant du rappel
   * aux parents (`envoi_recap_hebdo`/`_parent`) et des récaps aux établissements
   * (`envoi_etablissement`). `foyerId` en UUID, `semaineIso` au format `YYYY-Www`.
   */
  @ScopeFoyerInterServices({ param: 'foyerId' })
  @Get('validations/semaine/:foyerId/:semaineIso/envois')
  suivi(
    @Param('foyerId', ParseUUIDPipe) foyerId: string,
    @Param('semaineIso', SemaineIsoPipe) semaineIso: string,
  ): Promise<SuiviEnvoisVue> {
    return this.suivis.lire(foyerId, semaineIso);
  }

  /**
   * Mois **communiqués** d'un foyer (SFD 30, US-30-05, **lecture seule**) : les mois
   * `YYYY-MM` pour lesquels un récap a réellement été envoyé à un établissement. Bornage
   * optionnel `?du=YYYY-MM&au=YYYY-MM` (mois inclus) pour se limiter à la période
   * d'impact d'une correction. Sert l'avertissement « déjà envoyé à la crèche ».
   */
  @ScopeFoyerInterServices({ param: 'foyerId' })
  @Get('foyers/:foyerId/mois-communiques')
  moisCommuniques(
    @Param('foyerId', ParseUUIDPipe) foyerId: string,
    @Query('du') du?: string,
    @Query('au') au?: string,
  ): Promise<{ mois: string[] }> {
    return this.suivis.moisCommuniques(
      foyerId,
      this.moisOuRejeter(du, 'du'),
      this.moisOuRejeter(au, 'au'),
    );
  }

  /** Valide un mois `YYYY-MM` optionnel (400 si présent mais mal formé). */
  private moisOuRejeter(
    valeur: string | undefined,
    champ: string,
  ): string | undefined {
    if (valeur === undefined) return undefined;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valeur)) {
      throw new BadRequestException([
        { champ, message: `mois invalide (attendu YYYY-MM) : ${valeur}` },
      ]);
    }
    return valeur;
  }

  /** Envoie réellement le récap agrégé au service (après relecture). Idempotent. */
  @ScopeFoyerInterServices({ body: 'foyerId' })
  @Post('envois/etablissement')
  @HttpCode(HttpStatus.OK)
  envoyer(
    @Body(new ZodValidationPipe(envoiEtablissementSchema))
    dto: EnvoiEtablissementDto,
  ): Promise<EnvoiEtablissementResultat> {
    // `sujet`/`corps` sont fournis ensemble ou pas du tout (invariant du schéma) : on
    // ne transmet le corps édité que lorsque les deux sont présents.
    const corpsEdite =
      dto.sujet !== undefined && dto.corps !== undefined
        ? { sujet: dto.sujet, corps: dto.corps }
        : undefined;
    return this.envois.envoyer(
      dto.foyerId,
      dto.semaineIso,
      dto.etablissementId,
      corpsEdite,
    );
  }
}
