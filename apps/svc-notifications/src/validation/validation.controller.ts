import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SemaineIsoPipe } from './validation.dto.js';
import type {
  NotificationAValiderVue,
  ValidationResultat,
} from './validation.dto.js';
import { ValidationService } from './validation.service.js';

/**
 * Validation hebdomadaire du planning (`/api/validations`). Deux endpoints :
 * la liste des semaines `A_VALIDER` d'un foyer (indicateur in-app) et la validation
 * d'une semaine d'un contrat. La forme des paramètres (UUID, semaine ISO) est
 * vérifiée par des pipes ; la logique de diff/idempotence vit dans le service.
 */
@Controller('validations')
export class ValidationController {
  constructor(private readonly validation: ValidationService) {}

  /** Liste les semaines à valider d'un foyer : `?foyer=<uuid>`. */
  @Get('a-valider')
  aValider(
    @Query('foyer', ParseUUIDPipe) foyerId: string,
  ): Promise<NotificationAValiderVue[]> {
    return this.validation.aValider(foyerId);
  }

  /** Valide la semaine `:semaineIso` du contrat `:contratId` (idempotent). */
  @Post(':contratId/:semaineIso')
  @HttpCode(HttpStatus.OK)
  valider(
    @Param('contratId', ParseUUIDPipe) contratId: string,
    @Param('semaineIso', SemaineIsoPipe) semaineIso: string,
  ): Promise<ValidationResultat> {
    return this.validation.valider(contratId, semaineIso);
  }
}
