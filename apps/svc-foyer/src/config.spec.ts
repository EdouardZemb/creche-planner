import { describe, expect, it } from 'vitest';
import { loadConfig, SECRET_DESABONNEMENT_DEV } from './config.js';

/**
 * Déclaration d'environnement de `svc-foyer` (`AM-44`, lot 5 standards).
 *
 * Depuis le lot 5, `loadConfig(env)` **est** le garde-fou de démarrage (plus de
 * `verifierConfigProduction()` séparé, donc plus de garde qu'un `main.ts` puisse
 * oublier d'appeler). L'env est passé en **paramètre** : aucun test ne mute
 * `process.env`.
 */

/** Un env de production réaliste : le compose pose base et bus (cf. AM-44). */
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://foyer:secret@postgres-foyer:5432/foyer',
  NATS_URL: 'nats://nats:4222',
} as const;

describe('loadConfig — secret de désabonnement en production (RFC 8058)', () => {
  it('refuse le démarrage en production sans secret', () => {
    expect(() => loadConfig(PROD)).toThrow(
      /DESABONNEMENT_TOKEN_SECRET requis en production/u,
    );
  });

  it('refuse un secret vide ou blanc (var posée mais non remplie)', () => {
    expect(() =>
      loadConfig({ ...PROD, DESABONNEMENT_TOKEN_SECRET: '' }),
    ).toThrow(/DESABONNEMENT_TOKEN_SECRET requis/u);
    expect(() =>
      loadConfig({ ...PROD, DESABONNEMENT_TOKEN_SECRET: '   ' }),
    ).toThrow(/DESABONNEMENT_TOKEN_SECRET requis/u);
  });

  it('refuse le repli de dev laissé en production', () => {
    expect(() =>
      loadConfig({
        ...PROD,
        DESABONNEMENT_TOKEN_SECRET: SECRET_DESABONNEMENT_DEV,
      }),
    ).toThrow(/DESABONNEMENT_TOKEN_SECRET requis/u);
  });

  it('ne cite jamais le secret reçu dans le refus', () => {
    let message = '';
    try {
      loadConfig({ ...PROD, DESABONNEMENT_TOKEN_SECRET: '   ' });
    } catch (erreur) {
      message = (erreur as Error).message;
    }
    expect(message).toContain('DESABONNEMENT_TOKEN_SECRET');
    expect(message).not.toContain(SECRET_DESABONNEMENT_DEV);
  });

  it('démarre en production avec un vrai secret', () => {
    expect(() =>
      loadConfig({
        ...PROD,
        DESABONNEMENT_TOKEN_SECRET: 'un-vrai-secret-de-prod-long-et-aleatoire',
      }),
    ).not.toThrow();
  });

  it("n'exige rien hors production (dev local, test, NODE_ENV absent)", () => {
    for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }]) {
      expect(() => loadConfig(env)).not.toThrow();
      expect(loadConfig(env).desabonnement.secret).toBe(
        SECRET_DESABONNEMENT_DEV,
      );
    }
  });
});

describe('loadConfig — replis localhost en production (AM-44)', () => {
  it('refuse le démarrage si la base ou le bus ne sont pas posés', () => {
    let message = '';
    try {
      loadConfig({
        NODE_ENV: 'production',
        DESABONNEMENT_TOKEN_SECRET: 'vrai-secret',
      });
    } catch (erreur) {
      message = (erreur as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('NATS_URL');
    // Le repli de la base porte un couple utilisateur/mot de passe de dev : il
    // est nommé, jamais imprimé.
    expect(message).not.toContain('foyer:foyer@');
  });

  it('accepte les replis localhost hors production (pile de dev)', () => {
    expect(loadConfig({}).databaseUrl).toContain('localhost:5434/foyer');
  });
});

describe('loadConfig — TTL du jeton de désabonnement', () => {
  it('30 jours par défaut', () => {
    expect(loadConfig({}).desabonnement.ttlJours).toBe(30);
  });

  it('lit une valeur posée', () => {
    expect(
      loadConfig({ DESABONNEMENT_TOKEN_TTL_JOURS: '7' }).desabonnement.ttlJours,
    ).toBe(7);
  });

  // Un TTL illisible donnait `NaN`, donc une date d'expiration `Invalid Date` :
  // le jeton n'était plus jamais valide, et rien ne le disait au démarrage.
  it.each(['abc', '0', '366', '1.5'])(
    'refuse le démarrage pour un TTL inexploitable (%s)',
    (valeur) => {
      expect(() =>
        loadConfig({ DESABONNEMENT_TOKEN_TTL_JOURS: valeur }),
      ).toThrow(/DESABONNEMENT_TOKEN_TTL_JOURS/u);
    },
  );
});

describe('loadConfig — assertion inter-services', () => {
  it('mode legacy par défaut (aucun secret, observe-only)', () => {
    expect(loadConfig({}).assertion).toEqual({
      secret: undefined,
      enforce: false,
    });
  });

  it('lit le secret et la bascule d’enforce', () => {
    expect(
      loadConfig({
        ASSERTION_IDENTITE_SECRET: 's3cr3t',
        INTERSERVICE_AUTHZ_ENFORCE: '1',
      }).assertion,
    ).toEqual({ secret: 's3cr3t', enforce: true });
  });

  // Clé HMAC partagée avec la passerelle : la rogner d'un côté seulement ferait
  // échouer toutes les vérifications d'assertion. Refus au démarrage.
  it('refuse un secret d’assertion entouré d’espaces', () => {
    expect(() => loadConfig({ ASSERTION_IDENTITE_SECRET: ' s3cr3t ' })).toThrow(
      /ASSERTION_IDENTITE_SECRET.*espaces/su,
    );
  });
});
