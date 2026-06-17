import {
  type INestApplication,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { loadConfig } from './config.js';

/**
 * Configuration commune de l'application Nest, **partagée** entre le bootstrap de
 * production (`main.ts`) et le test E2E API — afin d'éviter toute dérive entre les
 * deux (préfixe global, versionnage URI, CORS).
 *
 * - **Préfixe** : toutes les routes sous `/api`.
 * - **Versionnage URI** : les contrôleurs BFF portent `version: '1'` → `/api/v1/…` ;
 *   les transverses (health/referentiel/openapi) restent **neutres** → `/api/…`.
 * - **CORS** : `['*']` (défaut dev) reflète toutes les origines ; sinon liste blanche.
 */
export function configurerApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
  });
  const { corsOrigins } = loadConfig();
  app.enableCors(
    corsOrigins.includes('*') ? undefined : { origin: [...corsOrigins] },
  );
}
