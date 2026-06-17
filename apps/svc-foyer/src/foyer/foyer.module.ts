import { Module } from '@nestjs/common';
import { FoyerController } from './foyer.controller.js';
import { FoyerService } from './foyer.service.js';

@Module({
  controllers: [FoyerController],
  providers: [FoyerService],
})
export class FoyerModule {}
