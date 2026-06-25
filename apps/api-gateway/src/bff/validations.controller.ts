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
  estSemaineIso,
  joursDeLaSemaine,
  moisDeLaSemaine,
} from '@creche-planner/shared-semaine';
import {
  NotificationsClient,
  type BrouillonVue,
  type EnvoiResultat,
  type NotificationAValiderVue,
  type ValidationResultat,
} from '../clients/notifications.client.js';
import { PlanificationClient } from '../clients/planification.client.js';
import { valider } from './bff.dto.js';
import { relayer } from './relais.js';
import {
  agregerSemaineBesoins,
  estContratActifSurSemaine,
  type ContratAvecSaisies,
  type SemaineBesoinsVue,
} from './semaine-besoins.js';

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
  constructor(
    private readonly notifications: NotificationsClient,
    private readonly planification: PlanificationClient,
  ) {}

  /**
   * Vue hebdomadaire **consolidée et éditable** d'un foyer (lecture seule) : pour la
   * semaine `:semaineIso`, agrège les contrats actifs du foyer (mêmes bornes que le
   * scheduler de notification) et, pour chacun, ses besoins datés extraits de la/des
   * saisie(s) mensuelle(s) réelle(s) (`simule=false`), rattachés à leur établissement.
   * Sert d'écran d'édition ouvert depuis une notification A_VALIDER.
   */
  @Get('semaine/:foyerId/:semaineIso/besoins')
  semaineBesoins(
    @Param('foyerId') foyerId: string,
    @Param('semaineIso') semaineIso: string,
  ): Promise<SemaineBesoinsVue> {
    if (!estSemaineIso(semaineIso)) {
      throw new BadRequestException([
        {
          champ: 'semaineIso',
          message: 'semaine ISO attendue au format YYYY-Www',
        },
      ]);
    }
    const jours = joursDeLaSemaine(semaineIso);
    const mois = moisDeLaSemaine(semaineIso);
    return relayer(async () => {
      const [contrats, annuaire] = await Promise.all([
        this.planification.listerContrats(foyerId),
        this.notifications.listerEtablissements(),
      ]);
      const actifs = contrats.filter((c) =>
        estContratActifSurSemaine(c, jours),
      );
      const avecSaisies: ContratAvecSaisies[] = await Promise.all(
        actifs.map(async (contrat) => {
          const saisies = await Promise.all(
            mois.map(async (m) => {
              const { saisie } = await this.planification.lirePlanning(
                contrat.id,
                m,
                false,
              );
              return saisie;
            }),
          );
          return { contrat, saisies };
        }),
      );
      return agregerSemaineBesoins({
        semaineIso,
        jours,
        contrats: avecSaisies,
        annuaire,
      });
    });
  }

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
