import {
  champEnv,
  CHAMPS_ASSERTION,
  configAssertion,
  lireEnv,
  type ConfigAssertion,
} from '@creche-planner/nest-commons';

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
  /** Assertion d'identité inter-services (secret + enforce) — fondations lot 3. */
  readonly assertion: ConfigAssertion;
}

/**
 * Variables d'environnement lues par ce service (`AM-44`, lot 5 standards).
 * **Cette déclaration est l'inventaire** : toute variable lue ailleurs qu'ici est
 * refusée par la porte `pnpm environnement`, et toute variable posée par un
 * compose sans figurer ici est un réglage inerte.
 */
export const CHAMPS_ENV = {
  PORT: champEnv.port(3005),
  DATABASE_URL: champEnv.urlPostgres(
    'postgres://tarification:tarification@localhost:5436/tarification',
  ),
  NATS_URL: champEnv.urlNats('nats://localhost:4222'),
  REFERENTIEL_URL: champEnv.urlService('http://localhost:3001'),
  FOYER_URL: champEnv.urlService('http://localhost:3002'),
  PLANIFICATION_URL: champEnv.urlService('http://localhost:3004'),
  ...CHAMPS_ASSERTION,
} as const;

/**
 * Configuration du service, **validée** au premier appel (donc au démarrage :
 * `main.ts` l'appelle en première instruction). Une variable illisible refuse le
 * démarrage en nommant le champ, au lieu de propager un `NaN` ou un repli
 * `localhost` jusqu'à la première requête.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServiceConfig {
  const valeurs = lireEnv('svc-tarification', CHAMPS_ENV, { env });
  return {
    port: valeurs.PORT,
    databaseUrl: valeurs.DATABASE_URL,
    natsUrl: valeurs.NATS_URL,
    referentielUrl: valeurs.REFERENTIEL_URL,
    foyerUrl: valeurs.FOYER_URL,
    planificationUrl: valeurs.PLANIFICATION_URL,
    assertion: configAssertion(valeurs),
  };
}
