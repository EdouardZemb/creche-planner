import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import {
  CLES_ETABLISSEMENT,
  upsertEtablissementSchema,
  ZodValidationPipe,
  type CleEtablissement,
  type UpsertEtablissementDto,
} from './etablissement.dto.js';
import {
  EtablissementService,
  type EtablissementVue,
} from './etablissement.service.js';

/**
 * CRUD léger des établissements destinataires (`/api/etablissements`). Lecture de
 * la liste (les 2 établissements seedés) et upsert par clé. La validation métier
 * (forme de la règle de préavis, e-mail) vit dans le schéma Zod du corps ; la clé
 * de chemin est vérifiée contre `CLES_ETABLISSEMENT`.
 */
@Controller('etablissements')
export class EtablissementController {
  constructor(private readonly etablissements: EtablissementService) {}

  @Get()
  lister(): Promise<EtablissementVue[]> {
    return this.etablissements.lister();
  }

  @Put(':cle')
  upsert(
    @Param('cle') cle: string,
    @Body(new ZodValidationPipe(upsertEtablissementSchema))
    dto: UpsertEtablissementDto,
  ): Promise<EtablissementVue> {
    return this.etablissements.upsert(this.cleValide(cle), dto);
  }

  /** Vérifie que la clé de chemin est une clé d'établissement connue (→ 400). */
  private cleValide(cle: string): CleEtablissement {
    const connue = CLES_ETABLISSEMENT.find((c) => c === cle);
    if (!connue) {
      throw new BadRequestException([
        {
          champ: 'cle',
          message: `clé d'établissement inconnue : ${cle}`,
        },
      ]);
    }
    return connue;
  }
}
