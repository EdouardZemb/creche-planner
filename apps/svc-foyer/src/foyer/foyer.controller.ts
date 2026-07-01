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
import type { FoyerId } from '@creche-planner/contracts-foyer';
import {
  ajouterEnfantSchema,
  ajouterParentSchema,
  ecrireFoyerSchema,
  majPreferencesSchema,
  modifierEnfantSchema,
  modifierParentSchema,
  ZodValidationPipe,
  type AjouterEnfantDto,
  type AjouterParentDto,
  type EcrireFoyerDto,
  type MajPreferencesDto,
  type ModifierEnfantDto,
  type ModifierParentDto,
} from './foyer.dto.js';
import {
  FoyerService,
  type EnfantVue,
  type FoyerVue,
  type ParentVue,
  type PreferenceVue,
} from './foyer.service.js';

@Controller('foyers')
export class FoyerController {
  constructor(private readonly foyers: FoyerService) {}

  @Post()
  creer(
    @Body(new ZodValidationPipe(ecrireFoyerSchema)) dto: EcrireFoyerDto,
  ): Promise<FoyerVue> {
    return this.foyers.creer(dto);
  }

  /**
   * Liste les foyers. Avec `?parentEmail=…`, bascule en **résolution
   * identité→foyers** : renvoie les `foyerId` dont l'e-mail est parent actif
   * (insensible à la casse) — utilisé par le BFF pour l'autorisation par foyer.
   */
  @Get()
  lister(
    @Query('parentEmail') parentEmail?: string,
  ): Promise<FoyerVue[] | FoyerId[]> {
    if (parentEmail !== undefined) {
      return this.foyers.foyersParEmail(parentEmail);
    }
    return this.foyers.lister();
  }

  @Get(':id')
  obtenir(@Param('id', ParseUUIDPipe) id: string): Promise<FoyerVue> {
    return this.foyers.obtenir(id);
  }

  @Put(':id')
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ecrireFoyerSchema)) dto: EcrireFoyerDto,
  ): Promise<FoyerVue> {
    return this.foyers.mettreAJour(id, dto);
  }

  @Post(':id/enfants')
  @HttpCode(HttpStatus.CREATED)
  ajouterEnfant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ajouterEnfantSchema)) dto: AjouterEnfantDto,
  ): Promise<EnfantVue> {
    return this.foyers.ajouterEnfant(id, dto);
  }

  @Get(':id/enfants')
  listerEnfants(@Param('id', ParseUUIDPipe) id: string): Promise<EnfantVue[]> {
    return this.foyers.listerEnfants(id);
  }

  @Put(':id/enfants/:enfantId')
  modifierEnfant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enfantId', ParseUUIDPipe) enfantId: string,
    @Body(new ZodValidationPipe(modifierEnfantSchema)) dto: ModifierEnfantDto,
  ): Promise<EnfantVue> {
    return this.foyers.modifierEnfant(id, enfantId, dto);
  }

  @Delete(':id/enfants/:enfantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  retirerEnfant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enfantId', ParseUUIDPipe) enfantId: string,
  ): Promise<void> {
    return this.foyers.retirerEnfant(id, enfantId);
  }

  @Post(':id/parents')
  @HttpCode(HttpStatus.CREATED)
  ajouterParent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ajouterParentSchema)) dto: AjouterParentDto,
  ): Promise<ParentVue> {
    return this.foyers.ajouterParent(id, dto);
  }

  @Get(':id/parents')
  listerParents(@Param('id', ParseUUIDPipe) id: string): Promise<ParentVue[]> {
    return this.foyers.listerParents(id);
  }

  @Put(':id/parents/:parentId')
  modifierParent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body(new ZodValidationPipe(modifierParentSchema)) dto: ModifierParentDto,
  ): Promise<ParentVue> {
    return this.foyers.modifierParent(id, parentId, dto);
  }

  @Delete(':id/parents/:parentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  retirerParent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
  ): Promise<void> {
    return this.foyers.retirerParent(id, parentId);
  }

  /** Préférences de notification effectives du parent (défaut §5.1 + choix stockés). */
  @Get(':id/parents/:parentId/preferences')
  lirePreferences(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
  ): Promise<PreferenceVue[]> {
    return this.foyers.lirePreferences(id, parentId);
  }

  /**
   * Met à jour les préférences du parent. `400` si l'état résultant coupe tous les
   * canaux d'un type de service (invariant ≥ 1 canal actif, §5.3).
   */
  @Put(':id/parents/:parentId/preferences')
  majPreferences(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body(new ZodValidationPipe(majPreferencesSchema)) dto: MajPreferencesDto,
  ): Promise<PreferenceVue[]> {
    return this.foyers.majPreferences(id, parentId, dto);
  }
}
