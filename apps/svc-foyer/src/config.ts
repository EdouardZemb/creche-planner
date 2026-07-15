export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
  /** Désabonnement one-click (RFC 8058, PR5) : secret de signature + validité du jeton. */
  readonly desabonnement: DesabonnementConfig;
}

/**
 * Configuration du **désabonnement one-click** (RFC 8058). Le secret signe les
 * jetons `desabonnement_token` ; la vraie valeur de prod est posée en PR7 dans
 * `.env.server.enc` (`DESABONNEMENT_TOKEN_SECRET`). Le défaut de dev n'est **pas**
 * un secret de prod — un déploiement réel doit fournir la variable.
 */
export interface DesabonnementConfig {
  readonly secret: string;
  /** Durée de validité d'un lien de désabonnement (jours). */
  readonly ttlJours: number;
}

/**
 * Secret de désabonnement de **dev uniquement** (défaut local). Ce n'est **pas**
 * un secret de prod : `verifierConfigProduction` refuse de démarrer en production
 * s'il est resté à cette valeur (comme absent/vide). Source **unique**, réutilisée
 * par `loadConfig` **et** le garde-fou (jamais deux littéraux à garder synchro).
 */
export const SECRET_DESABONNEMENT_DEV = 'dev-desabonnement-secret-non-prod';

/**
 * Garde-fou de démarrage (miroir de `api-gateway/verifierConfigProduction`) : en
 * production, le secret HMAC qui signe les jetons de désabonnement one-click
 * (RFC 8058) doit être un **vrai** secret, jamais le fallback de dev. Sans lui,
 * les liens « se désabonner » seraient signés avec une constante **publique**,
 * donc forgeables. Hors production, aucune exigence (dev/test tournent sur le
 * défaut). **Aucune échappatoire** : le secret est toujours requis en prod.
 */
export function verifierConfigProduction(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  const secret = env['DESABONNEMENT_TOKEN_SECRET']?.trim();
  if (
    secret === undefined ||
    secret === '' ||
    secret === SECRET_DESABONNEMENT_DEV
  ) {
    throw new Error(
      'DESABONNEMENT_TOKEN_SECRET requis en production : les jetons de ' +
        'désabonnement one-click (RFC 8058) sont signés avec ce secret HMAC. ' +
        'Absent, vide ou resté au défaut de dev, les liens de désabonnement ' +
        'seraient forgeables. Poser un vrai secret dans .env.server.enc.',
    );
  }
}

/** Configuration du service depuis l'environnement, avec des défauts de dev local. */
export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 3002),
    databaseUrl:
      process.env['DATABASE_URL'] ??
      'postgres://foyer:foyer@localhost:5434/foyer',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
    desabonnement: {
      secret:
        process.env['DESABONNEMENT_TOKEN_SECRET'] ?? SECRET_DESABONNEMENT_DEV,
      ttlJours: Number(process.env['DESABONNEMENT_TOKEN_TTL_JOURS'] ?? 30),
    },
  };
}
