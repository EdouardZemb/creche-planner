import { Global, Module } from '@nestjs/common';
import { FoyerClient } from './foyer.client.js';
import { NotificationsClient } from './notifications.client.js';
import { PlanificationClient } from './planification.client.js';
import { TarificationClient } from './tarification.client.js';

@Global()
@Module({
  providers: [
    FoyerClient,
    PlanificationClient,
    TarificationClient,
    NotificationsClient,
  ],
  exports: [
    FoyerClient,
    PlanificationClient,
    TarificationClient,
    NotificationsClient,
  ],
})
export class ClientsModule {}
