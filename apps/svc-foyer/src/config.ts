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
        process.env['DESABONNEMENT_TOKEN_SECRET'] ??
        'dev-desabonnement-secret-non-prod',
      ttlJours: Number(process.env['DESABONNEMENT_TOKEN_TTL_JOURS'] ?? 30),
    },
  };
}
