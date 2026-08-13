import './tracing.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { configurerApp } from './app.config.js';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

async function bootstrap(): Promise<void> {
  // Fail-fast : la configuration d'environnement est lue et VALIDÉE avant que
  // quoi que ce soit ne soit monté (AM-44, lot 5 standards). Une variable
  // illisible, ou une exigence de production non tenue — en prod, l'auth
  // désactivée doit rester un choix explicite (AQ-01, doc 27) — arrête le
  // processus en nommant le champ fautif.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configurerApp(app);
  app.enableShutdownHooks();

  await app.listen(config.port);
  app
    .get(Logger)
    .log(`api-gateway à l'écoute sur http://localhost:${config.port}/api`);
}

void bootstrap();
