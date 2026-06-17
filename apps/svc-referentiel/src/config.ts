export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
}

/** Configuration du service depuis l'environnement, avec des défauts de dev local. */
export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 3001),
    databaseUrl:
      process.env['DATABASE_URL'] ??
      'postgres://referentiel:referentiel@localhost:5433/referentiel',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
  };
}
