import {
  lireConfigAssertion,
  type ConfigAssertion,
} from '@creche-planner/nest-commons';

export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
  /** URL du service Référentiel (jours non facturables du calendrier). */
  readonly referentielUrl: string;
  /** Assertion d'identité inter-services (secret + enforce) — fondations lot 3. */
  readonly assertion: ConfigAssertion;
}

/** Configuration du service depuis l'environnement, avec des défauts de dev local. */
export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 3004),
    databaseUrl:
      process.env['DATABASE_URL'] ??
      'postgres://planification:planification@localhost:5435/planification',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
    referentielUrl: process.env['REFERENTIEL_URL'] ?? 'http://localhost:3001',
    assertion: lireConfigAssertion(),
  };
}
