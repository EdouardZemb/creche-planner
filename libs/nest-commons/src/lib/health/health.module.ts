import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { NatsHealthIndicator } from './nats.health.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, NatsHealthIndicator],
})
export class HealthModule {}
