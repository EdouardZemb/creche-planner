import './tracing.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { DomainExceptionFilter } from '@creche-planner/nest-commons';

async function bootstrap(): Promise<void> {
  // Fail-fast : la configuration d'environnement est lue et VALIDÉE avant que
  // quoi que ce soit ne soit monté (AM-44, lot 5 standards) — donc avant
  // d'ouvrir un pool Postgres et un consommateur JetStream. Une variable
  // illisible, ou une exigence de production non tenue — en production, les URL
  // de base des liens d'e-mail doivent être publiques (https + domaine), jamais
  // l'IP LAN du serveur ni localhost, sinon le parent hors-réseau reçoit un lien
  // injoignable ou à certificat invalide — arrête le processus en nommant le
  // champ fautif, sur `stderr` (le logger pino n'existe pas encore ici, et c'est
  // le prix assumé pour ne rien monter avant d'avoir accepté la config).
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.log(
    `svc-notifications à l'écoute sur http://localhost:${config.port}/api`,
  );
}

void bootstrap();
