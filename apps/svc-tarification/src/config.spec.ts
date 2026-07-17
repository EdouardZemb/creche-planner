import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * `loadConfig()` lit l'environnement du conteneur (`PORT` / `DATABASE_URL` /
 * `NATS_URL` / `REFERENTIEL_URL` / `FOYER_URL` / `PLANIFICATION_URL`) et
 * retombe sur les défauts de dev local. Chaque test isole ces variables
 * (snapshot + restauration en `afterEach`) pour ne fuir aucun état. Modèle :
 * `apps/svc-referentiel/src/config.spec.ts` (lui-même calqué sur
 * `apps/svc-foyer/src/config.spec.ts`).
 */
describe('loadConfig (svc-tarification)', () => {
  const CLES = [
    'PORT',
    'DATABASE_URL',
    'NATS_URL',
    'REFERENTIEL_URL',
    'FOYER_URL',
    'PLANIFICATION_URL',
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

  it("lit PORT / DATABASE_URL / NATS_URL / les URL de repli depuis l'environnement", () => {
    process.env['PORT'] = '4005';
    process.env['DATABASE_URL'] = 'postgres://u:p@db:5432/tarif';
    process.env['NATS_URL'] = 'nats://broker:4222';
    process.env['REFERENTIEL_URL'] = 'http://svc-referentiel:3001';
    process.env['FOYER_URL'] = 'http://svc-foyer:3002';
    process.env['PLANIFICATION_URL'] = 'http://svc-planification:3004';

    expect(loadConfig()).toEqual({
      port: 4005,
      databaseUrl: 'postgres://u:p@db:5432/tarif',
      natsUrl: 'nats://broker:4222',
      referentielUrl: 'http://svc-referentiel:3001',
      foyerUrl: 'http://svc-foyer:3002',
      planificationUrl: 'http://svc-planification:3004',
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
