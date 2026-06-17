export const PG_CLIENT = Symbol('PG_CLIENT');
export const DRIZZLE = Symbol('DRIZZLE');
export const OPTIONS_DATABASE = Symbol('OPTIONS_DATABASE');

/** Points de variance du module database, fournis par chaque service. */
export interface OptionsDatabase {
  /**
   * Schéma Drizzle du service (type `db.query`). Côté service, l'injection reste
   * typée finement via un alias local `PostgresJsDatabase<typeof schema>`.
   */
  schema: Record<string, unknown>;
  /** URL de la base, résolue paresseusement (l'environnement est lu à l'instanciation). */
  urlBase: () => string;
  /**
   * Dossier des migrations embarquées dans le bundle. Résolu par le service
   * (`join(__dirname, 'database', 'migrations')` : assets webpack du service).
   */
  dossierMigrations: string;
}
