import {
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
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
import { ZodValidationPipe } from '../planification/planification.dto.js';
import {
  lireCalendrierQuerySchema,
  lireCoucheQuerySchema,
  poserExceptionSchema,
  remplacerRecurrencesSchema,
  importerAnneeSchema,
  saisirPeriodeSchema,
  type LireCalendrierQuery,
  type LireCoucheQuery,
  type PoserExceptionDto,
  type RemplacerRecurrencesDto,
  type ImporterAnneeDto,
  type SaisirPeriodeDto,
} from './calendrier.dto.js';
import {
  CalendrierImportService,
  type ResultatImport,
} from './calendrier-import.service.js';
import {
  CalendrierService,
  type CalendrierResoluVue,
  type ExceptionVue,
  type PeriodeVue,
  type RecurrenceVue,
} from './calendrier.service.js';

/**
 * **Calendrier d'ouverture d'un établissement** (SFD 31, lot 2).
 *
 * Toutes les routes sont portées par `:id` (l'établissement) et scopées par le
 * patron **déjà en place** du service : `@ScopeFoyerInterServices({ resoudre:
 * 'etablissement', param: 'id' })`, résolu par `ResolveurFoyerPlanification`
 * (`security/resolveur-foyer.ts`) qui sait déjà lire `etablissement → foyer`.
 * Aucun nouveau résolveur : la ressource existe, seule la route est neuve. Le
 * décorateur est posé dès le premier commit — jamais d'observe-only qui casserait
 * à la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` (§4 du plan).
 *
 * ## `aLaDate` — le paramètre qui ne bougera plus
 *
 * `GET …/calendrier` est le **contrat gelé** du chantier : le plan 33 le
 * consommera par client REST inter-services **sans pact**. `aLaDate` y entre dès
 * la première publication, avec sa sémantique : *l'instant de connaissance auquel
 * lire le calendrier*, **omis = maintenant**. Il n'est pas une option de confort —
 * l'ajouter après coup casserait un consommateur qu'aucune porte ne surveille.
 *
 * Les trois couches brutes l'acceptent aussi, pour la même raison et à la même
 * sémantique : un écran qui montre « ce que le calendrier disait en juin » n'a
 * pas à réimplémenter la réduction, il redemande la couche au même instant.
 */
@Controller('etablissements/:id/calendrier')
export class CalendrierController {
  constructor(
    private readonly calendrier: CalendrierService,
    private readonly imports: CalendrierImportService,
  ) {}

  /**
   * Jours résolus de `[du, au]` (bornes **inclusives**), tels que connus à
   * `aLaDate` (défaut : maintenant). 400 si la plage est inversée ou trop large.
   */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Get()
  lire(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(lireCalendrierQuerySchema))
    query: LireCalendrierQuery,
  ): Promise<CalendrierResoluVue> {
    return this.calendrier.lireResolu(id, query.du, query.au, query.aLaDate);
  }

  /** Récurrence hebdomadaire connue à `aLaDate` (couche 3). */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Get('recurrences')
  lireRecurrences(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(lireCoucheQuerySchema)) query: LireCoucheQuery,
  ): Promise<{ aLaDate: string; recurrences: RecurrenceVue[] }> {
    return this.calendrier.lireRecurrences(id, query.aLaDate);
  }

  /** Remplace la récurrence hebdomadaire d'un bloc (append-only : clôt et ouvre). */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Put('recurrences')
  remplacerRecurrences(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(remplacerRecurrencesSchema))
    dto: RemplacerRecurrencesDto,
  ): Promise<{ aLaDate: string; recurrences: RecurrenceVue[] }> {
    return this.calendrier.remplacerRecurrences(id, dto);
  }

  /** Périodes connues à `aLaDate` (couche 2). */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Get('periodes')
  lirePeriodes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(lireCoucheQuerySchema)) query: LireCoucheQuery,
  ): Promise<{ aLaDate: string; periodes: PeriodeVue[] }> {
    return this.calendrier.lirePeriodes(id, query.aLaDate);
  }

  /**
   * Importe une année scolaire depuis l'open data (US-31-01, lot 3).
   *
   * `POST` et non `PUT` : l'appel n'est pas idempotent au sens HTTP — il **date**
   * un import, et le rejouer clôt les lignes précédentes pour en ouvrir de
   * nouvelles. Il l'est en revanche au sens métier : rejouer ne cumule rien. La
   * distinction compte — c'est elle qui rend le double-clic inoffensif sans rendre
   * l'historique faux.
   */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Post('import')
  @HttpCode(HttpStatus.OK)
  importerAnnee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(importerAnneeSchema)) dto: ImporterAnneeDto,
  ): Promise<ResultatImport> {
    return this.imports.importerAnnee(id, dto.anneeScolaire);
  }

  /** Ouvre une période saisie manuellement (`source: MANUEL` imposé). */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Post('periodes')
  @HttpCode(HttpStatus.CREATED)
  saisirPeriode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saisirPeriodeSchema)) dto: SaisirPeriodeDto,
  ): Promise<PeriodeVue> {
    return this.calendrier.saisirPeriode(id, dto);
  }

  /** Retouche une période : clôt l'existante, en ouvre une nouvelle. */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Put('periodes/:periodeId')
  retoucherPeriode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('periodeId', ParseUUIDPipe) periodeId: string,
    @Body(new ZodValidationPipe(saisirPeriodeSchema)) dto: SaisirPeriodeDto,
  ): Promise<PeriodeVue> {
    return this.calendrier.retoucherPeriode(id, periodeId, dto);
  }

  /**
   * « Supprime » une période — c'est-à-dire la **clôt** : la ligne reste en base
   * et reste lisible à tout `aLaDate` antérieur. Rien n'est effacé, jamais.
   */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Delete('periodes/:periodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clorePeriode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('periodeId', ParseUUIDPipe) periodeId: string,
  ): Promise<void> {
    await this.calendrier.clorePeriode(id, periodeId);
  }

  /** Exceptions connues à `aLaDate` (couche 1). */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Get('exceptions')
  lireExceptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(lireCoucheQuerySchema)) query: LireCoucheQuery,
  ): Promise<{ aLaDate: string; exceptions: ExceptionVue[] }> {
    return this.calendrier.lireExceptions(id, query.aLaDate);
  }

  /**
   * Pose une exception sur un jour — **upsert par jour** : une exception déjà
   * ouverte ce jour-là est close, la nouvelle ouverte au même instant. C'est
   * pourquoi il n'y a pas de `PUT` : retoucher une exception, c'est en reposer une.
   */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Post('exceptions')
  @HttpCode(HttpStatus.CREATED)
  poserException(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(poserExceptionSchema)) dto: PoserExceptionDto,
  ): Promise<ExceptionVue> {
    return this.calendrier.poserException(id, dto);
  }

  /** Clôt une exception (jamais de suppression physique). */
  @ScopeFoyerInterServices({ resoudre: 'etablissement', param: 'id' })
  @Delete('exceptions/:exceptionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cloreException(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
  ): Promise<void> {
    await this.calendrier.cloreException(id, exceptionId);
  }
}
