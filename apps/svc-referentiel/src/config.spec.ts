import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * Déclaration d'environnement de `svc-referentiel` (`AM-44`, lot 5 standards).
 * `loadConfig(env)` valide ce qu'il lit et prend son environnement en paramètre :
 * le snapshot/restauration de `process.env` qu'exigeait cette spec a disparu.
 */
describe('loadConfig (svc-referentiel)', () => {
  it("applique les défauts de dev local quand aucune variable n'est posée", () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      databaseUrl:
        'postgres://referentiel:referentiel@localhost:5433/referentiel',
      natsUrl: 'nats://localhost:4222',
      assertion: { secret: undefined, enforce: false },
    });
  });

  it("lit PORT / DATABASE_URL / NATS_URL depuis l'environnement", () => {
    expect(
      loadConfig({
        PORT: '4005',
        DATABASE_URL: 'postgres://u:p@db:5432/ref',
        NATS_URL: 'nats://broker:4222',
      }),
    ).toEqual({
      port: 4005,
      databaseUrl: 'postgres://u:p@db:5432/ref',
      natsUrl: 'nats://broker:4222',
      assertion: { secret: undefined, enforce: false },
    });
  });

  // ÉCART ASSUMÉ AU LOT 5 — cette spec AFFIRMAIT le défaut : « PORT non numérique
  // → NaN (coercition Number brute, pas de garde) ». `listen(NaN)` fait écouter
  // Node sur un port éphémère : le conteneur démarre, la healthcheck du port
  // déclaré échoue, et Docker le redémarre en boucle sans qu'aucun log ne nomme
  // la variable. Le refus au démarrage remplace la boucle.
  it.each(['pas-un-nombre', '0', '65536', '3001.5'])(
    'refuse le démarrage sur un PORT inexploitable (%s)',
    (valeur) => {
      expect(() => loadConfig({ PORT: valeur })).toThrow(/PORT/u);
    },
  );

  it('refuse le démarrage en production sur les replis localhost (AM-44)', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL[\s\S]*NATS_URL|NATS_URL[\s\S]*DATABASE_URL/u,
    );
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
