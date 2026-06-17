import { Module } from '@nestjs/common';
import { CoutController } from './cout.controller.js';
import { CoutService } from './cout.service.js';

/** API « coût du mois/an » : valorise le read model via le domaine tarifaire. */
@Module({
  controllers: [CoutController],
  providers: [CoutService],
})
export class TarificationModule {}
