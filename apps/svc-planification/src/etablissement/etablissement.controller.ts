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
import { ZodValidationPipe } from '../planification/planification.dto.js';
import {
  creerEtablissementSchema,
  modifierEtablissementSchema,
  type CreerEtablissementDto,
  type ModifierEtablissementDto,
} from './etablissement.dto.js';
import {
  EtablissementService,
  type EtablissementVue,
} from './etablissement.service.js';

@Controller('etablissements')
export class EtablissementController {
  constructor(private readonly etablissements: EtablissementService) {}

  /** Liste les établissements d'un foyer : `?foyer=`. */
  @Get()
  lister(
    @Query('foyer', ParseUUIDPipe) foyerId: string,
  ): Promise<EtablissementVue[]> {
    return this.etablissements.lister(foyerId);
  }

  /** Crée un établissement pour un foyer (`?foyer=`) → émet `EtablissementCree`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  creer(
    @Query('foyer', ParseUUIDPipe) foyerId: string,
    @Body(new ZodValidationPipe(creerEtablissementSchema))
    dto: CreerEtablissementDto,
  ): Promise<EtablissementVue> {
    return this.etablissements.creer(foyerId, dto);
  }

  /** Lit un établissement par son id. 404 si absent. */
  @Get(':id')
  parId(@Param('id', ParseUUIDPipe) id: string): Promise<EtablissementVue> {
    return this.etablissements.parId(id);
  }

  /** Modifie un établissement (champs fournis) → émet `EtablissementModifie`. */
  @Put(':id')
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(modifierEtablissementSchema))
    dto: ModifierEtablissementDto,
  ): Promise<EtablissementVue> {
    return this.etablissements.modifier(id, dto);
  }

  /** Supprime un établissement → émet `EtablissementSupprime`. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.etablissements.supprimer(id);
  }
}
