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
import type {
  PrestationMois,
  PrestationsMoisCreche,
} from '@creche-planner/planification-domain';
import {
  creerContratSchema,
  ecrirePlanningSchema,
  modifierContratSchema,
  ISO_MOIS,
  ZodValidationPipe,
  type CreerContratDto,
  type EcrirePlanningDto,
  type ModifierContratDto,
} from './planification.dto.js';
import {
  PlanificationService,
  type ContratVue,
  type ContratDetailVue,
} from './planification.service.js';

/** Réponse « prestations du mois » sérialisée (Durée → minutes). */
interface PrestationsMoisReponse {
  readonly contratId: string;
  readonly mois: string;
  readonly simule: boolean;
  readonly prestations: ReadonlyArray<Record<string, unknown>>;
}

@Controller()
export class PlanificationController {
  constructor(private readonly planification: PlanificationService) {}

  /** Liste les contrats d'un foyer (config mode-spécifique incluse) : `?foyer=`. */
  @Get('contrats')
  listerContrats(
    @Query('foyer', ParseUUIDPipe) foyerId: string,
  ): Promise<ContratDetailVue[]> {
    return this.planification.listerContrats(foyerId);
  }

  /** Crée un contrat de garde → insère + émet `ContratCree` dans la transaction. */
  @Post('contrats')
  @HttpCode(HttpStatus.CREATED)
  creerContrat(
    @Body(new ZodValidationPipe(creerContratSchema)) dto: CreerContratDto,
  ): Promise<ContratVue> {
    return this.planification.creerContrat(dto);
  }

  /** Modifie un contrat de garde → met à jour + émet `ContratModifie`. */
  @Put('contrats/:id')
  modifierContrat(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(modifierContratSchema)) dto: ModifierContratDto,
  ): Promise<ContratVue> {
    return this.planification.modifierContrat(id, dto);
  }

  /** Supprime un contrat de garde (+ ses plannings) → émet `ContratSupprime`. */
  @Delete('contrats/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async supprimerContrat(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.planification.supprimerContrat(id);
  }

  /**
   * Enregistre le planning d'un mois (réel par défaut, simulé si `?simule=true`)
   * → émet `PlanningModifie` dans la transaction.
   */
  @Put('contrats/:id/plannings/:mois')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ecrirePlanning(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mois') mois: string,
    @Body(new ZodValidationPipe(ecrirePlanningSchema)) dto: EcrirePlanningDto,
    @Query('simule') simule?: string,
  ): Promise<void> {
    this.exigerMois(mois);
    await this.planification.ecrirePlanning(id, mois, simule === 'true', dto);
  }

  /**
   * Lit la saisie de planning enregistrée d'un mois (réelle ou simulée) pour
   * réhydrater les calendriers de l'app. Renvoie `{ saisie: null }` si aucune
   * saisie n'existe encore pour ce mois.
   */
  @Get('contrats/:id/plannings/:mois')
  async lirePlanning(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mois') mois: string,
    @Query('simule') simule?: string,
  ): Promise<{ saisie: EcrirePlanningDto | null }> {
    this.exigerMois(mois);
    const saisie = await this.planification.lirePlanning(
      id,
      mois,
      simule === 'true',
    );
    return { saisie };
  }

  /** Prestations du mois d'un contrat (cœur DoD) : `?contrat=&mois=&simule=`. */
  @Get('prestations')
  async prestations(
    @Query('contrat', ParseUUIDPipe) contratId: string,
    @Query('mois') mois?: string,
    @Query('simule') simule?: string,
  ): Promise<PrestationsMoisReponse> {
    const moisOk = this.exigerMois(mois);
    const estSimule = simule === 'true';
    const planning = await this.planification.prestationsMois(
      contratId,
      moisOk,
      estSimule,
    );
    return {
      contratId,
      mois: planning.mois,
      simule: estSimule,
      prestations: planning.prestations.map((p) => this.serialiser(p)),
    };
  }

  /** Sérialise une prestation : les `Duree` du mode crèche → minutes (entiers). */
  private serialiser(prestation: PrestationMois): Record<string, unknown> {
    if (prestation.mode === 'CRECHE_PSU') {
      const creche = prestation as PrestationsMoisCreche;
      return {
        mode: creche.mode,
        heuresAnnuellesContractualisees: creche.heuresAnnuellesContractualisees,
        nbMensualites: creche.nbMensualites,
        heuresMensualisees: creche.heuresMensualisees,
        complementMinutes: creche.complement.enMinutes,
        heuresReserveesMinutes: creche.heuresReservees.enMinutes,
        heuresDeduitesMinutes: creche.heuresDeduites.enMinutes,
      };
    }
    return { ...prestation };
  }

  private exigerMois(mois: string | undefined): string {
    if (mois === undefined || !ISO_MOIS.test(mois)) {
      throw new BadRequestException(
        'paramètre « mois » requis au format YYYY-MM',
      );
    }
    return mois;
  }
}
