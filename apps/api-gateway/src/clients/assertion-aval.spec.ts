import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ENTETE_ASSERTION,
  verifierAssertion,
} from '@creche-planner/nest-commons';
import { executerAvecContexteAssertion } from '../security/contexte-assertion.js';
import { entetesAval } from './assertion-aval.js';

const SECRET = 'secret-aval-test';

/** Décode l'assertion présente dans les en-têtes produits par `entetesAval`. */
function decoder(entetes: Record<string, string>) {
  const jeton = entetes[ENTETE_ASSERTION];
  return jeton ? verifierAssertion(jeton, SECRET, new Date()) : null;
}

describe('entetesAval', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('secret absent → aucun en-tête (mode legacy aval)', () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    expect(entetesAval()).toEqual({});
  });

  it('hors requête identifiée (pas de contexte ALS) → assertion machine api-gateway', () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = SECRET;
    const charge = decoder(entetesAval());
    expect(charge?.machine).toBe('api-gateway');
    expect(charge?.email).toBeUndefined();
  });

  it('dans un contexte parent → assertion parent { email, foyers, admin }', () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = SECRET;
    const charge = executerAvecContexteAssertion(
      { email: 'parent@test.fr', foyers: ['f-1', 'f-2'], admin: false },
      () => decoder(entetesAval()),
    );
    expect(charge?.email).toBe('parent@test.fr');
    expect(charge?.foyers).toEqual(['f-1', 'f-2']);
    expect(charge?.admin).toBe(false);
    expect(charge?.machine).toBeUndefined();
  });

  it('contexte parent sans foyers (route non scopée) → assertion parent sans foyers', () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = SECRET;
    const charge = executerAvecContexteAssertion(
      { email: 'parent@test.fr' },
      () => decoder(entetesAval()),
    );
    expect(charge?.email).toBe('parent@test.fr');
    expect(charge).not.toHaveProperty('foyers');
    expect(charge).not.toHaveProperty('admin');
  });
});
