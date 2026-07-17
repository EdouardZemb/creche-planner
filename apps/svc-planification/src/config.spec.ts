import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * `loadConfig()` lit l'environnement du conteneur (`PORT` / `DATABASE_URL` /
 * `NATS_URL` / `REFERENTIEL_URL`) et retombe sur les défauts de dev local.
 * Chaque test isole ces variables (snapshot + restauration en `afterEach`)
 * pour ne fuir aucun état. Modèle : `apps/svc-referentiel/src/config.spec.ts`
 * (lui-même calqué sur `apps/svc-foyer/src/config.spec.ts`).
 */
describe('loadConfig (svc-planification)', () => {
  const CLES = [
    'PORT',
    'DATABASE_URL',
    'NATS_URL',
    'REFERENTIEL_URL',
    'ASSERTION_IDENTITE_SECRET',
    'INTERSERVICE_AUTHZ_ENFORCE',
  ] as const;
  const initial: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const cle of CLES) {
      initial[cle] = process.env[cle];
      Reflect.deleteProperty(process.env, cle);
    }
  });

  afterEach(() => {
    for (const cle of CLES) {
      const valeur = initial[cle];
      if (valeur === undefined) {
        Reflect.deleteProperty(process.env, cle);
      } else {
        process.env[cle] = valeur;
      }
    }
  });

  it("applique les défauts de dev local quand aucune variable n'est posée", () => {
    expect(loadConfig()).toEqual({
      port: 3004,
      databaseUrl:
        'postgres://planification:planification@localhost:5435/planification',
      natsUrl: 'nats://localhost:4222',
      referentielUrl: 'http://localhost:3001',
      assertion: { secret: undefined, enforce: false },
    });
  });

  it("lit PORT / DATABASE_URL / NATS_URL / REFERENTIEL_URL depuis l'environnement", () => {
    process.env['PORT'] = '4004';
    process.env['DATABASE_URL'] = 'postgres://u:p@db:5432/planif';
    process.env['NATS_URL'] = 'nats://broker:4222';
    process.env['REFERENTIEL_URL'] = 'http://svc-referentiel:3001';

    expect(loadConfig()).toEqual({
      port: 4004,
      databaseUrl: 'postgres://u:p@db:5432/planif',
      natsUrl: 'nats://broker:4222',
      referentielUrl: 'http://svc-referentiel:3001',
      assertion: { secret: undefined, enforce: false },
    });
  });

  it('coerce PORT en nombre (Number(port))', () => {
    process.env['PORT'] = '8080';
    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(typeof config.port).toBe('number');
  });

  it('PORT non numérique → NaN (coercition Number brute, pas de garde)', () => {
    process.env['PORT'] = 'pas-un-nombre';
    expect(Number.isNaN(loadConfig().port)).toBe(true);
  });

  it("lit l'assertion d'identité inter-services (fondations lot 3)", () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = 'secret-test';
    process.env['INTERSERVICE_AUTHZ_ENFORCE'] = '1';
    expect(loadConfig().assertion).toEqual({
      secret: 'secret-test',
      enforce: true,
    });
  });
});
