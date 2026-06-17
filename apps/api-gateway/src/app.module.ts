import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from '@creche-planner/observability';
import { BffModule } from './bff/bff.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { HealthModule } from './health/health.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';
import { ReferentielModule } from './referentiel/referentiel.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams('api-gateway')),
    SecurityModule,
    ClientsModule,
    HealthModule,
    ReferentielModule,
    BffModule,
    OpenApiModule,
  ],
})
export class AppModule {}
