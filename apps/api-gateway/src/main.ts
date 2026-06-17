import './tracing.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { configurerApp } from './app.config.js';
import { AppModule } from './app.module.js';
import { loadConfig, verifierConfigProduction } from './config.js';

async function bootstrap(): Promise<void> {
  // Fail-fast AVANT de monter quoi que ce soit : en prod, l'auth désactivée
  // doit être un choix explicite (AQ-01, doc 27).
  verifierConfigProduction();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configurerApp(app);
  app.enableShutdownHooks();

  const { port } = loadConfig();
  await app.listen(port);
  app
    .get(Logger)
    .log(`api-gateway à l'écoute sur http://localhost:${port}/api`);
}

void bootstrap();
