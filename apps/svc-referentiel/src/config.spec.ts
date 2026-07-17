import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * `loadConfig()` lit l'environnement du conteneur (`PORT` / `DATABASE_URL` /
 * `NATS_URL`) et retombe sur les défauts de dev local. Chaque test isole ces trois
 * variables (snapshot + restauration en `afterEach`) pour ne fuir aucun état.
 * Modèle : `apps/svc-foyer/src/config.spec.ts`.
 */
describe('loadConfig (svc-referentiel)', () => {
  const CLES = ['PORT', 'DATABASE_URL', 'NATS_URL'] as const;
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
      port: 3001,
      databaseUrl:
        'postgres://referentiel:referentiel@localhost:5433/referentiel',
      natsUrl: 'nats://localhost:4222',
    });
  });

  it("lit PORT / DATABASE_URL / NATS_URL depuis l'environnement", () => {
    process.env['PORT'] = '4005';
    process.env['DATABASE_URL'] = 'postgres://u:p@db:5432/ref';
    process.env['NATS_URL'] = 'nats://broker:4222';

    expect(loadConfig()).toEqual({
      port: 4005,
      databaseUrl: 'postgres://u:p@db:5432/ref',
      natsUrl: 'nats://broker:4222',
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
});
