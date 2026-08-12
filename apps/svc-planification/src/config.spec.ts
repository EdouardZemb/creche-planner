import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * Déclaration d'environnement de `svc-planification` (`AM-44`, lot 5 standards).
 * `loadConfig(env)` valide ce qu'il lit et prend son environnement en paramètre :
 * le snapshot/restauration de `process.env` qu'exigeait cette spec a disparu.
 */
describe('loadConfig (svc-planification)', () => {
  it("applique les défauts de dev local quand aucune variable n'est posée", () => {
    expect(loadConfig({})).toEqual({
      port: 3004,
      databaseUrl:
        'postgres://planification:planification@localhost:5435/planification',
      natsUrl: 'nats://localhost:4222',
      referentielUrl: 'http://localhost:3001',
      assertion: { secret: undefined, enforce: false },
    });
  });

  it("lit PORT / DATABASE_URL / NATS_URL / REFERENTIEL_URL depuis l'environnement", () => {
    expect(
      loadConfig({
        PORT: '4004',
        DATABASE_URL: 'postgres://u:p@db:5432/planif',
        NATS_URL: 'nats://broker:4222',
        REFERENTIEL_URL: 'http://svc-referentiel:3001',
      }),
    ).toEqual({
      port: 4004,
      databaseUrl: 'postgres://u:p@db:5432/planif',
      natsUrl: 'nats://broker:4222',
      referentielUrl: 'http://svc-referentiel:3001',
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
    for (const nom of ['DATABASE_URL', 'NATS_URL', 'REFERENTIEL_URL']) {
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
