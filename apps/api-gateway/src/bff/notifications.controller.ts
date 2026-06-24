import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import {
  NotificationsClient,
  type EtablissementVue,
} from '../clients/notifications.client.js';
import {
  CLES_ETABLISSEMENT,
  upsertEtablissementSchema,
  valider,
} from './bff.dto.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/etablissements` : agrège `svc-notifications`. Lecture de
 * l'annuaire des établissements destinataires et upsert par clé (adresse du
 * service + règle de préavis). La forme du corps est validée ici puis relayée.
 */
@Controller({ path: 'etablissements', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsClient) {}

  /** Liste les établissements destinataires. */
  @Get()
  lister(): Promise<EtablissementVue[]> {
    return relayer(() => this.notifications.listerEtablissements());
  }

  /** Met à jour un établissement par clé (upsert). */
  @Put(':cle')
  upsert(
    @Param('cle') cle: string,
    @Body() corps: unknown,
  ): Promise<EtablissementVue> {
    if (!CLES_ETABLISSEMENT.some((c) => c === cle)) {
      throw new BadRequestException([
        { champ: 'cle', message: `clé d'établissement inconnue : ${cle}` },
      ]);
    }
    const saisie = valider(upsertEtablissementSchema, corps);
    return relayer(() => this.notifications.upsertEtablissement(cle, saisie));
  }
}
