import './tracing.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { DomainExceptionFilter } from '@creche-planner/nest-commons';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  const { port } = loadConfig();
  await app.listen(port);
  app
    .get(Logger)
    .log(`svc-referentiel à l'écoute sur http://localhost:${port}/api`);
}

void bootstrap();
