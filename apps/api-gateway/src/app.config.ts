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
 * - **`trust proxy`** : nombre de relais de confiance (`RATE_LIMIT_PROXY_HOPS`),
 *   pour que `req.ip` désigne le **client** et non le dernier relais.
 */
export function configurerApp(app: INestApplication): void {
  // `trust proxy` AVANT tout le reste : `req.ip` en dépend, et c'est lui qui sert
  // de clé au `RateLimitGuard`. Laissé à `false` (défaut Express), `req.ip` valait
  // l'adresse du reverse-proxy pour 100 % du trafic — une seule fenêtre de débit
  // partagée par tous les clients au lieu d'une par client (AN-15). Le compte de
  // sauts est dérivé de la topologie versionnée (cf. `proxyHops`, config.ts) ;
  // `0` (défaut) conserve le comportement d'origine, seul défaut sûr.
  const { corsOrigins, proxyHops } = loadConfig();
  // `getInstance()` renvoie `any` : on le referme aussitôt sur la seule méthode qui
  // nous intéresse, pour ne pas laisser un `any` se propager (règles type-aware).
  const serveur = app.getHttpAdapter().getInstance() as unknown as {
    set(cle: string, valeur: unknown): void;
  };
  serveur.set('trust proxy', proxyHops);

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
  });
  app.enableCors(
    corsOrigins.includes('*') ? undefined : { origin: [...corsOrigins] },
  );
}
