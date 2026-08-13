import './tracing.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { DomainExceptionFilter } from '@creche-planner/nest-commons';

async function bootstrap(): Promise<void> {
  // Fail-fast : la configuration d'environnement est lue et VALIDÉE avant que
  // quoi que ce soit ne soit monté (AM-44, lot 5 standards). Une variable
  // illisible, ou une exigence de production non tenue — en prod, le secret HMAC
  // de désabonnement one-click doit être un vrai secret, jamais le repli de
  // dev — arrête le processus en nommant le champ fautif.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.port);
  app
    .get(Logger)
    .log(`svc-foyer à l'écoute sur http://localhost:${config.port}/api`);
}

void bootstrap();
