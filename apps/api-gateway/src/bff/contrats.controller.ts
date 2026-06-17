import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  PlanificationClient,
  type ContratVue,
  type LirePlanningReponse,
  type SaisieContrat,
} from '../clients/planification.client.js';
import {
  creerContratSchema,
  ecrirePlanningSchema,
  modifierContratSchema,
  moisSchema,
  valider,
} from './bff.dto.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/contrats` : relaie `svc-planification` (création de contrat
 * crèche/ABCM et écriture du planning mensuel réel ou simulé).
 */
@Controller({ path: 'contrats', version: '1' })
export class ContratsController {
  constructor(private readonly planification: PlanificationClient) {}

  /** Liste les contrats d'un foyer : `?foyer=<uuid>`. */
  @Get()
  lister(
    @Query('foyer') foyer: string | undefined,
  ): Promise<readonly ContratVue[]> {
    if (!foyer) {
      throw new BadRequestException('paramètre « foyer » requis');
    }
    return relayer(() => this.planification.listerContrats(foyer));
  }

  /** Crée un contrat de garde. */
  @Post()
  creer(@Body() corps: unknown): Promise<ContratVue> {
    const saisie = valider(creerContratSchema, corps);
    return relayer(() =>
      this.planification.creerContrat(saisie as SaisieContrat),
    );
  }

  /** Modifie un contrat de garde existant. */
  @Put(':id')
  modifier(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ContratVue> {
    const saisie = valider(modifierContratSchema, corps);
    return relayer(() =>
      this.planification.modifierContrat(id, saisie as SaisieContrat),
    );
  }

  /** Supprime un contrat de garde. */
  @Delete(':id')
  @HttpCode(204)
  async supprimer(@Param('id') id: string): Promise<void> {
    await relayer(() => this.planification.supprimerContrat(id));
  }

  /** Lit la saisie de planning d'un mois (réel par défaut, simulé si `?simule=true`). */
  @Get(':id/plannings/:mois')
  lirePlanning(
    @Param('id') id: string,
    @Param('mois') mois: string,
    @Query('simule') simule: string | undefined,
  ): Promise<LirePlanningReponse> {
    valider(moisSchema, mois);
    return relayer(() =>
      this.planification.lirePlanning(id, mois, simule === 'true'),
    );
  }

  /** Écrit le planning d'un mois (réel par défaut, simulé si `?simule=true`). */
  @Put(':id/plannings/:mois')
  @HttpCode(204)
  async ecrirePlanning(
    @Param('id') id: string,
    @Param('mois') mois: string,
    @Query('simule') simule: string | undefined,
    @Body() corps: unknown,
  ): Promise<void> {
    valider(moisSchema, mois);
    const planning = valider(ecrirePlanningSchema, corps);
    await relayer(() =>
      this.planification.ecrirePlanning(id, mois, simule === 'true', planning),
    );
  }
}
