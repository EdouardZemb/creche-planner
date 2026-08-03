import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { AmontsHealthIndicator } from './amonts.health.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [AmontsHealthIndicator],
})
export class HealthModule {}
