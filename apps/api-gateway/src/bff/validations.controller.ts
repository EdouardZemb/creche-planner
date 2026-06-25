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
  type BrouillonEtablissementVue,
  type EnvoiEtablissementResultat,
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
 * Corps minimal de la demande d'envoi agrégé (`POST …/envois/etablissement`). La forme
 * fine (UUID, semaine ISO, clé d'établissement) est revalidée par le service amont ;
 * ici on s'assure des champs requis.
 */
const envoiEtablissementSchema = z.object({
  foyerId: z.string().min(1),
  semaineIso: z.string().min(1),
  cle: z.string().min(1),
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

  /**
   * Régénère le brouillon **agrégé par établissement** (relecture avant envoi) : un seul
   * mail par établissement regroupant tous les enfants du foyer validés avec modifications.
   */
  @Get('semaine/:foyerId/:semaineIso/etablissements/:cle/brouillon')
  brouillon(
    @Param('foyerId') foyerId: string,
    @Param('semaineIso') semaineIso: string,
    @Param('cle') cle: string,
  ): Promise<BrouillonEtablissementVue> {
    return relayer(() =>
      this.notifications.lireBrouillonEtablissement(foyerId, semaineIso, cle),
    );
  }

  /**
   * Envoie réellement le récap **agrégé par établissement** au service (après relecture).
   * Idempotent sur `(foyer, semaine, établissement)`.
   */
  @Post('envois/etablissement')
  envoyer(@Body() corps: unknown): Promise<EnvoiEtablissementResultat> {
    const { foyerId, semaineIso, cle } = valider(
      envoiEtablissementSchema,
      corps,
    );
    return relayer(() =>
      this.notifications.envoyerRecapEtablissement(foyerId, semaineIso, cle),
    );
  }
}
