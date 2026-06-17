export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
}

/** Configuration du service depuis l'environnement, avec des défauts de dev local. */
export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 3002),
    databaseUrl:
      process.env['DATABASE_URL'] ??
      'postgres://foyer:foyer@localhost:5434/foyer',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
  };
}
