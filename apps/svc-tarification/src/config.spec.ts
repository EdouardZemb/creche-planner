import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * Déclaration d'environnement de `svc-tarification` (`AM-44`, lot 5 standards).
 * `loadConfig(env)` valide ce qu'il lit et prend son environnement en paramètre :
 * le snapshot/restauration de `process.env` qu'exigeait cette spec a disparu.
 */
describe('loadConfig (svc-tarification)', () => {
  it("applique les défauts de dev local quand aucune variable n'est posée", () => {
    expect(loadConfig({})).toEqual({
      port: 3005,
      databaseUrl:
        'postgres://tarification:tarification@localhost:5436/tarification',
      natsUrl: 'nats://localhost:4222',
      referentielUrl: 'http://localhost:3001',
      foyerUrl: 'http://localhost:3002',
      planificationUrl: 'http://localhost:3004',
      assertion: { secret: undefined, enforce: false },
    });
  });

  it("lit PORT / DATABASE_URL / NATS_URL / les URL amont depuis l'environnement", () => {
    expect(
      loadConfig({
        PORT: '4005',
        DATABASE_URL: 'postgres://u:p@db:5432/tarif',
        NATS_URL: 'nats://broker:4222',
        REFERENTIEL_URL: 'http://svc-referentiel:3001',
        FOYER_URL: 'http://svc-foyer:3002',
        PLANIFICATION_URL: 'http://svc-planification:3004',
      }),
    ).toEqual({
      port: 4005,
      databaseUrl: 'postgres://u:p@db:5432/tarif',
      natsUrl: 'nats://broker:4222',
      referentielUrl: 'http://svc-referentiel:3001',
      foyerUrl: 'http://svc-foyer:3002',
      planificationUrl: 'http://svc-planification:3004',
      assertion: { secret: undefined, enforce: false },
    });
  });

  // ÉCART ASSUMÉ AU LOT 5 — cf. `svc-referentiel` : cette spec affirmait le NaN.
  it.each(['pas-un-nombre', '0', '65536'])(
    'refuse le démarrage sur un PORT inexploitable (%s)',
    (valeur) => {
      expect(() => loadConfig({ PORT: valeur })).toThrow(/PORT/u);
    },
  );

  it('refuse le démarrage en production sur les replis localhost (AM-44)', () => {
    let message = '';
    try {
      loadConfig({ NODE_ENV: 'production' });
    } catch (erreur) {
      message = (erreur as Error).message;
    }
    // Les trois amonts synchrones ET la base : quatre constats d'un coup.
    for (const nom of [
      'DATABASE_URL',
      'NATS_URL',
      'REFERENTIEL_URL',
      'FOYER_URL',
      'PLANIFICATION_URL',
    ]) {
      expect(message).toContain(nom);
    }
  });

  it("lit l'assertion d'identité inter-services (fondations lot 3)", () => {
    expect(
      loadConfig({
        ASSERTION_IDENTITE_SECRET: 'secret-test',
        INTERSERVICE_AUTHZ_ENFORCE: '1',
      }).assertion,
    ).toEqual({ secret: 'secret-test', enforce: true });
  });
});
