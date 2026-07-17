import './tracing.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadConfig, verifierConfigProduction } from './config.js';
import { DomainExceptionFilter } from '@creche-planner/nest-commons';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  const config = loadConfig();
  // Garde-fou (prod-only) : en production, les URL de base des liens d'e-mail
  // (récap du mardi, désabonnement one-click) doivent être publiques (https +
  // domaine), jamais l'IP LAN du serveur ni localhost — sinon le parent
  // hors-réseau reçoit un lien injoignable / à certificat invalide. On journalise
  // le motif avant de propager le throw (le service refuse alors de démarrer).
  try {
    verifierConfigProduction(config);
  } catch (erreur) {
    logger.error(`Démarrage refusé : ${(erreur as Error).message}`);
    throw erreur;
  }

  await app.listen(config.port);
  logger.log(
    `svc-notifications à l'écoute sur http://localhost:${config.port}/api`,
  );
}

void bootstrap();
