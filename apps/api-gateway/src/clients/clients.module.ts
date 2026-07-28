import { Global, Module } from '@nestjs/common';
import { FoyerClient } from './foyer.client.js';
import { NotificationsClient } from './notifications.client.js';
import { PlanificationClient } from './planification.client.js';
import { ReferentielClient } from './referentiel.client.js';
import { TarificationClient } from './tarification.client.js';

@Global()
@Module({
  providers: [
    FoyerClient,
    PlanificationClient,
    TarificationClient,
    NotificationsClient,
    ReferentielClient,
  ],
  exports: [
    FoyerClient,
    PlanificationClient,
    TarificationClient,
    NotificationsClient,
    ReferentielClient,
  ],
})
export class ClientsModule {}
