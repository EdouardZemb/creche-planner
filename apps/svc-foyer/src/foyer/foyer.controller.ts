import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ajouterEnfantSchema,
  ecrireFoyerSchema,
  ZodValidationPipe,
  type AjouterEnfantDto,
  type EcrireFoyerDto,
} from './foyer.dto.js';
import {
  FoyerService,
  type EnfantVue,
  type FoyerVue,
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

  @Get()
  lister(): Promise<FoyerVue[]> {
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
}
