import {
  champEnv,
  CHAMPS_ASSERTION,
  configAssertion,
  lireEnv,
  type ConfigAssertion,
  type RegleProduction,
  type ValeursEnv,
} from '@creche-planner/nest-commons';

export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
  /** Désabonnement one-click (RFC 8058, PR5) : secret de signature + validité du jeton. */
  readonly desabonnement: DesabonnementConfig;
  /** Assertion d'identité inter-services (secret + enforce) — fondations lot 3. */
  readonly assertion: ConfigAssertion;
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
 * un secret de prod : la règle `REGLE_SECRET_DESABONNEMENT` refuse de démarrer en
 * production s'il est resté à cette valeur. Source **unique**, réutilisée par la
 * déclaration `CHAMPS_ENV` **et** par la règle (jamais deux littéraux à garder
 * synchro).
 */
export const SECRET_DESABONNEMENT_DEV = 'dev-desabonnement-secret-non-prod';

/**
 * Variables d'environnement lues par ce service (`AM-44`, lot 5 standards).
 * **Cette déclaration est l'inventaire** : toute variable lue ailleurs qu'ici est
 * refusée par la porte `pnpm environnement`, et toute variable posée par un
 * compose sans figurer ici est un réglage inerte.
 */
export const CHAMPS_ENV = {
  PORT: champEnv.port(3002),
  DATABASE_URL: champEnv.urlPostgres(
    'postgres://foyer:foyer@localhost:5434/foyer',
  ),
  NATS_URL: champEnv.urlNats('nats://localhost:4222'),
  DESABONNEMENT_TOKEN_SECRET: champEnv.secretAvecRepli(
    SECRET_DESABONNEMENT_DEV,
  ),
  // Borné à 365 j : au-delà, un lien de désabonnement circulant dans une vieille
  // boîte reste actionnable plus longtemps que la donnée qu'il protège.
  DESABONNEMENT_TOKEN_TTL_JOURS: champEnv.entier({
    defaut: 30,
    min: 1,
    max: 365,
  }),
  ...CHAMPS_ASSERTION,
} as const;

/**
 * Garde-fou de démarrage (jusqu'au lot 5 : `verifierConfigProduction()`, l'un des
 * trois homonymes du dépôt — cf. `libs/nest-commons/src/lib/config/env.ts`) : en
 * production, le secret HMAC qui signe les jetons de désabonnement one-click
 * (RFC 8058) doit être un **vrai** secret, jamais le repli de dev. Sans lui, les
 * liens « se désabonner » seraient signés avec une constante **publique**, donc
 * forgeables. Hors production, aucune exigence (dev/test tournent sur le repli).
 * **Aucune échappatoire** : le secret est toujours requis en prod.
 */
export const REGLE_SECRET_DESABONNEMENT: RegleProduction<
  ValeursEnv<typeof CHAMPS_ENV>
> = {
  nom: 'secret de désabonnement (RFC 8058)',
  verifier: (valeurs) =>
    valeurs.DESABONNEMENT_TOKEN_SECRET === SECRET_DESABONNEMENT_DEV
      ? 'DESABONNEMENT_TOKEN_SECRET requis en production : les jetons de ' +
        'désabonnement one-click sont signés avec ce secret HMAC. Resté au ' +
        'repli de dev (valeur publique), les liens seraient forgeables. Poser ' +
        'un vrai secret dans .env.server.enc.'
      : undefined,
};

/**
 * Configuration du service, **validée** au premier appel (donc au démarrage :
 * `main.ts` l'appelle en première instruction). Une variable illisible refuse le
 * démarrage en nommant le champ, au lieu de propager un `NaN` ou un repli
 * `localhost` jusqu'à la première requête.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServiceConfig {
  const valeurs = lireEnv('svc-foyer', CHAMPS_ENV, {
    env,
    regles: [REGLE_SECRET_DESABONNEMENT],
  });
  return {
    port: valeurs.PORT,
    databaseUrl: valeurs.DATABASE_URL,
    natsUrl: valeurs.NATS_URL,
    desabonnement: {
      secret: valeurs.DESABONNEMENT_TOKEN_SECRET,
      ttlJours: valeurs.DESABONNEMENT_TOKEN_TTL_JOURS,
    },
    assertion: configAssertion(valeurs),
  };
}
