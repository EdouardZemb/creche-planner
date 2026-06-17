import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { ReferentielHealthIndicator } from './referentiel.health.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [ReferentielHealthIndicator],
})
export class HealthModule {}
