import { Global, Module } from '@nestjs/common';
import { FoyerClient } from './foyer.client.js';
import { PlanificationClient } from './planification.client.js';
import { TarificationClient } from './tarification.client.js';

@Global()
@Module({
  providers: [FoyerClient, PlanificationClient, TarificationClient],
  exports: [FoyerClient, PlanificationClient, TarificationClient],
})
export class ClientsModule {}
