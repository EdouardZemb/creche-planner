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
  type SuiviEnvoisVue,
  type ValidationResultat,
} from '../clients/notifications.client.js';
import { PlanificationClient } from '../clients/planification.client.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import { valider } from './bff.dto.js';
import { relayer } from './relais.js';
import {
  agregerSemaineBesoins,
  estContratActifSurSemaine,
  type ContratAvecSaisies,
  type SemaineBesoinsVue,
} from './semaine-besoins.js';

/**
 * Corps de la demande d'envoi agrégé (`POST …/envois/etablissement`). La forme fine
 * (UUID foyer/établissement, semaine ISO) est revalidée par le service amont ; ici on
 * s'assure des champs requis. `sujet`/`corps` sont **optionnels** (rétro-compatibles) :
 * quand le parent a édité le brouillon dans l'app, ils voyagent jusqu'au service (mêmes
 * bornes qu'amont) ; invariant « les deux ensemble ou aucun » (sinon 400).
 */
const envoiEtablissementSchema = z
  .object({
    foyerId: z.string().min(1),
    semaineIso: z.string().min(1),
    etablissementId: z.string().min(1),
    sujet: z.string().min(1).max(300).optional(),
    corps: z.string().min(1).max(20000).optional(),
  })
  .refine((d) => (d.sujet == null) === (d.corps == null), {
    message: 'objet et corps doivent être fournis ensemble',
    path: ['corps'],
  });

/**
 * Une semaine à valider **enrichie** (jointure BFF avec les contrats du foyer) du prénom
 * de l'enfant et du mode de garde — pour distinguer plusieurs lignes d'une même semaine
 * dans l'encart de validation. `enfant`/`mode` sont absents si le contrat n'est plus listé
 * (la notification reste affichée avec son libellé de repli). Hand-typé hors OpenAPI : le
 * type web `NotificationAValider` est tenu à jour en miroir, sans drift attendu.
 */
export interface NotificationAValiderEnrichie extends NotificationAValiderVue {
  enfant?: string;
  mode?: string;
}

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
  @FoyerScope('param:foyerId')
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
      // Établissements **réels** du foyer (entité libre, `svc-planification`) : le
      // récap est routé par le lien explicite `contrat.etablissementId` (P3), plus via
      // l'annuaire fermé de `svc-notifications`.
      const [contrats, annuaire] = await Promise.all([
        this.planification.listerContrats(foyerId),
        this.planification.listerEtablissements(foyerId),
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

  /**
   * Liste les semaines à valider d'un foyer : `?foyer=<uuid>`. **Enrichit** chaque
   * notification (jointure BFF avec les contrats du foyer via `listerContrats`, déjà
   * contracté Pact) du prénom de l'enfant et du mode de garde, pour distinguer N lignes
   * d'une même semaine dans l'encart. Si un contrat n'est plus listé, la notification est
   * relayée telle quelle (l'écran retombe sur son libellé de repli). Aucun nouveau
   * contrat amont — on réutilise `listerContrats` (comme `semaineBesoins`).
   */
  @Get('a-valider')
  @FoyerScope('query:foyer')
  aValider(
    @Query('foyer') foyer?: string,
  ): Promise<NotificationAValiderEnrichie[]> {
    if (!foyer) {
      throw new BadRequestException([
        { champ: 'foyer', message: 'paramètre « foyer » requis' },
      ]);
    }
    return relayer(async () => {
      const [notifs, contrats] = await Promise.all([
        this.notifications.listerAValider(foyer),
        this.planification.listerContrats(foyer),
      ]);
      const parId = new Map(contrats.map((c) => [c.id, c]));
      return notifs.map((n) => {
        const contrat = parId.get(n.contratId);
        return contrat
          ? { ...n, enfant: contrat.enfant, mode: contrat.mode }
          : n;
      });
    });
  }

  /** Valide la semaine `:semaineIso` du contrat `:contratId`. */
  @Post('validations/:contratId/:semaineIso')
  @FoyerScope('contrat:contratId')
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
  @Get('semaine/:foyerId/:semaineIso/etablissements/:etablissementId/brouillon')
  @FoyerScope('param:foyerId')
  brouillon(
    @Param('foyerId') foyerId: string,
    @Param('semaineIso') semaineIso: string,
    @Param('etablissementId') etablissementId: string,
  ): Promise<BrouillonEtablissementVue> {
    return relayer(() =>
      this.notifications.lireBrouillonEtablissement(
        foyerId,
        semaineIso,
        etablissementId,
      ),
    );
  }

  /**
   * Suivi des envois de la semaine (B1, **lecture seule**) : statut persistant du rappel
   * aux parents et des récaps aux établissements, pour le bloc « Suivi des envois » de
   * l'encart de validation. La forme fine (UUID, semaine ISO) est revalidée par le
   * service amont.
   */
  @Get('semaine/:foyerId/:semaineIso/envois')
  @FoyerScope('param:foyerId')
  suivi(
    @Param('foyerId') foyerId: string,
    @Param('semaineIso') semaineIso: string,
  ): Promise<SuiviEnvoisVue> {
    return relayer(() =>
      this.notifications.lireSuiviEnvois(foyerId, semaineIso),
    );
  }

  /**
   * Envoie réellement le récap **agrégé par établissement** au service (après relecture).
   * Idempotent sur `(foyer, semaine, établissement)`.
   */
  @Post('envois/etablissement')
  @FoyerScope('body:foyerId')
  envoyer(@Body() body: unknown): Promise<EnvoiEtablissementResultat> {
    const { foyerId, semaineIso, etablissementId, sujet, corps } = valider(
      envoiEtablissementSchema,
      body,
    );
    // `sujet`/`corps` fournis ensemble ou pas du tout (invariant du schéma) : le corps
    // édité par le parent n'est transmis qu'en présence des deux.
    const corpsEdite =
      sujet !== undefined && corps !== undefined ? { sujet, corps } : undefined;
    return relayer(() =>
      this.notifications.envoyerRecapEtablissement(
        foyerId,
        semaineIso,
        etablissementId,
        corpsEdite,
      ),
    );
  }
}
