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
} from '@nestjs/common';
import {
  PlanificationClient,
  type EtablissementVue,
  type SaisieEtablissement,
} from '../clients/planification.client.js';
import {
  creerEtablissementSchema,
  modifierEtablissementSchema,
  valider,
} from './bff.dto.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/foyers/:foyerId/etablissements` : relaie le CRUD des
 * **établissements** (entité libre par foyer, P2) vers `svc-planification`. Nesté
 * sous `/foyers/:foyerId` car portée **par foyer** (et pour ne pas collisionner
 * avec l'ancien annuaire `/api/v1/etablissements` à clés de `svc-notifications`,
 * qui coexiste jusqu'à son démantèlement en P6).
 *
 * Le `foyerId` du chemin alimente `@FoyerScope('param:foyerId')` (autorisation par
 * foyer, PR7). La validation profonde (unicité du nom, etc.) reste au service.
 */
@Controller({ path: 'foyers/:foyerId/etablissements', version: '1' })
export class EtablissementsFoyerController {
  constructor(private readonly planification: PlanificationClient) {}

  /** Liste les établissements du foyer. */
  @Get()
  @FoyerScope('param:foyerId')
  lister(@Param('foyerId') foyerId: string): Promise<EtablissementVue[]> {
    return relayer(() => this.planification.listerEtablissements(foyerId));
  }

  /** Crée un établissement dans le foyer. */
  @Post()
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.CREATED)
  creer(
    @Param('foyerId') foyerId: string,
    @Body() corps: unknown,
  ): Promise<EtablissementVue> {
    const saisie = valider(creerEtablissementSchema, corps);
    return relayer(() =>
      this.planification.creerEtablissement(
        foyerId,
        saisie as SaisieEtablissement,
      ),
    );
  }

  /**
   * Modifie un établissement du foyer (champs fournis uniquement). Le `foyerId` du
   * chemin sert l'autorisation (`@FoyerScope`) ; l'établissement est ciblé par `:id`.
   */
  @Put(':id')
  @FoyerScope('param:foyerId')
  modifier(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<EtablissementVue> {
    const saisie = valider(modifierEtablissementSchema, corps);
    return relayer(() =>
      this.planification.modifierEtablissement(
        id,
        saisie as SaisieEtablissement,
      ),
    );
  }

  /** Supprime un établissement du foyer (409 si des contrats y sont rattachés). */
  @Delete(':id')
  @FoyerScope('param:foyerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async supprimer(@Param('id') id: string): Promise<void> {
    await relayer(() => this.planification.supprimerEtablissement(id));
  }
}
