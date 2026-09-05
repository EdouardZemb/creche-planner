import {
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
import {
  PlanificationClient,
  type CalendrierResoluVue,
  type ExceptionVue,
  type ExceptionsVue,
  type ImportCalendrierVue,
  type PeriodeVue,
  type PeriodesVue,
  type RecurrencesVue,
  type SaisieCalendrier,
} from '../clients/planification.client.js';
import {
  lireCalendrierQuerySchema,
  lireCoucheCalendrierQuerySchema,
  poserExceptionSchema,
  remplacerRecurrencesSchema,
  importerAnneeCalendrierSchema,
  saisirPeriodeSchema,
  valider,
} from './bff.dto.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import { relayer } from './relais.js';
import { RessourceCreee } from './ressource-creee.decorator.js';

/**
 * Façade BFF `/api/v1/foyers/:foyerId/etablissements/:id/calendrier*` — le
 * **calendrier d'ouverture** d'un établissement (SFD 31, lot 2), relayé vers
 * `svc-planification` qui en est propriétaire (H4).
 *
 * Nesté sous `/foyers/:foyerId` pour la même raison que le CRUD établissement : la
 * portée est **par foyer** (`@FoyerScope('param:foyerId')`), et le service applique
 * en plus son propre scoping `etablissement → foyer`.
 *
 * ## `aLaDate` traverse ici sa troisième couche
 *
 * Le paramètre parcourt quatre étapes — route amont, ce contrôleur, le schéma
 * `bff.dto`, puis le client web — et chacune peut le perdre **sans erreur** : un
 * `z.object` strippe ce qu'il ne connaît pas, et un `@Query()` non déclaré
 * n'existe simplement pas. Le symptôme serait une réponse valide, résolue au
 * mauvais instant de connaissance (`LE-48`). D'où la validation explicite du
 * paramètre à cette étape, et un test qui la traverse plutôt que de la supposer.
 */
@Controller({
  path: 'foyers/:foyerId/etablissements/:id/calendrier',
  version: '1',
})
export class CalendrierFoyerController {
  constructor(private readonly planification: PlanificationClient) {}

  /**
   * Jours résolus de `[du, au]` (bornes **inclusives**) tels que connus à
   * `aLaDate`. `aLaDate` omis = maintenant — l'instant réellement employé est
   * réverbéré dans la réponse.
   */
  @Get()
  @FoyerScope('param:foyerId')
  lire(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<CalendrierResoluVue> {
    const { du, au, aLaDate } = valider(lireCalendrierQuerySchema, query);
    return relayer(() =>
      this.planification.lireCalendrier(id, du, au, aLaDate),
    );
  }

  /** Récurrence hebdomadaire connue à `aLaDate` (couche 3). */
  @Get('recurrences')
  @FoyerScope('param:foyerId')
  lireRecurrences(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<RecurrencesVue> {
    const { aLaDate } = valider(lireCoucheCalendrierQuerySchema, query);
    return relayer(() =>
      this.planification.lireRecurrencesCalendrier(id, aLaDate),
    );
  }

  /** Remplace la semaine type d'un bloc (append-only : clôt puis ouvre). */
  @Put('recurrences')
  @FoyerScope('param:foyerId')
  remplacerRecurrences(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<RecurrencesVue> {
    const saisie = valider(remplacerRecurrencesSchema, corps);
    return relayer(() =>
      this.planification.remplacerRecurrencesCalendrier(
        id,
        saisie as SaisieCalendrier,
      ),
    );
  }

  /** Périodes connues à `aLaDate` (couche 2). */
  @Get('periodes')
  @FoyerScope('param:foyerId')
  lirePeriodes(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<PeriodesVue> {
    const { aLaDate } = valider(lireCoucheCalendrierQuerySchema, query);
    return relayer(() =>
      this.planification.lirePeriodesCalendrier(id, aLaDate),
    );
  }

  /** Ouvre une période saisie manuellement. */
  @Post('periodes')
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.CREATED)
  @RessourceCreee((vue: PeriodeVue) => vue.id)
  saisirPeriode(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<PeriodeVue> {
    const saisie = valider(saisirPeriodeSchema, corps);
    return relayer(() =>
      this.planification.saisirPeriodeCalendrier(
        id,
        saisie as SaisieCalendrier,
      ),
    );
  }

  /**
   * Importe une année scolaire depuis l'open data (US-31-01, lot 3).
   *
   * Le BFF ne parle PAS à data.education.gouv.fr : il relaie vers
   * `svc-planification`, qui seul sort sur Internet. La passerelle est exposée au
   * navigateur — lui donner une dépendance sortante de plus élargirait sa surface
   * pour rien, et le service est déjà celui qui écrit ce que l'import produit.
   */
  @Post('import')
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.OK)
  importerAnnee(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ImportCalendrierVue> {
    const { anneeScolaire } = valider(importerAnneeCalendrierSchema, corps);
    return relayer(() =>
      this.planification.importerCalendrier(id, anneeScolaire),
    );
  }

  /** Retouche une période : clôt l'existante, en ouvre une nouvelle. */
  @Put('periodes/:periodeId')
  @FoyerScope('param:foyerId')
  retoucherPeriode(
    @Param('id') id: string,
    @Param('periodeId') periodeId: string,
    @Body() corps: unknown,
  ): Promise<PeriodeVue> {
    const saisie = valider(saisirPeriodeSchema, corps);
    return relayer(() =>
      this.planification.retoucherPeriodeCalendrier(
        id,
        periodeId,
        saisie as SaisieCalendrier,
      ),
    );
  }

  /** Clôt une période (rien n'est effacé : la ligne reste lisible dans le passé). */
  @Delete('periodes/:periodeId')
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clorePeriode(
    @Param('id') id: string,
    @Param('periodeId') periodeId: string,
  ): Promise<void> {
    await relayer(() =>
      this.planification.clorePeriodeCalendrier(id, periodeId),
    );
  }

  /** Exceptions connues à `aLaDate` (couche 1). */
  @Get('exceptions')
  @FoyerScope('param:foyerId')
  lireExceptions(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<ExceptionsVue> {
    const { aLaDate } = valider(lireCoucheCalendrierQuerySchema, query);
    return relayer(() =>
      this.planification.lireExceptionsCalendrier(id, aLaDate),
    );
  }

  /** Pose une exception sur un jour (upsert par jour, append-only). */
  @Post('exceptions')
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.CREATED)
  @RessourceCreee((vue: ExceptionVue) => vue.id)
  poserException(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ExceptionVue> {
    const saisie = valider(poserExceptionSchema, corps);
    return relayer(() =>
      this.planification.poserExceptionCalendrier(
        id,
        saisie as SaisieCalendrier,
      ),
    );
  }

  /** Clôt une exception (rien n'est effacé). */
  @Delete('exceptions/:exceptionId')
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cloreException(
    @Param('id') id: string,
    @Param('exceptionId') exceptionId: string,
  ): Promise<void> {
    await relayer(() =>
      this.planification.cloreExceptionCalendrier(id, exceptionId),
    );
  }
}
