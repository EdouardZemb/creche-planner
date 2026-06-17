export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
  /** URL du service Référentiel (grilles/barèmes applicables) — fallback synchrone. */
  readonly referentielUrl: string;
  /** URL du service Foyer (ressources/rfr/tranche/parts) — fallback synchrone. */
  readonly foyerUrl: string;
  /** URL du service Planification (prestations du mois) — fallback synchrone. */
  readonly planificationUrl: string;
}

/** Configuration du service depuis l'environnement, avec des défauts de dev local. */
export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 3005),
    databaseUrl:
      process.env['DATABASE_URL'] ??
      'postgres://tarification:tarification@localhost:5436/tarification',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
    referentielUrl: process.env['REFERENTIEL_URL'] ?? 'http://localhost:3001',
    foyerUrl: process.env['FOYER_URL'] ?? 'http://localhost:3002',
    planificationUrl:
      process.env['PLANIFICATION_URL'] ?? 'http://localhost:3004',
  };
}
