import { describe, expect, it } from 'vitest';
import { ResolveurFoyerPlanification } from './resolveur-foyer.js';
import type { Database } from '../database/database.types.js';

const FOYER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ID = '11111111-1111-4111-8111-111111111111';

/**
 * Base factice honorant `select({...}).from().where().limit()` : renvoie `rows`
 * (0 ou 1 ligne). Le prédicat n'est pas évalué — le test fixe directement le résultat.
 */
function fakeDb(rows: readonly { foyerId: string }[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  } as unknown as Database;
}

describe('ResolveurFoyerPlanification', () => {
  it('contrat existant → portée foyer', async () => {
    const r = new ResolveurFoyerPlanification(fakeDb([{ foyerId: FOYER }]));
    await expect(r.resoudre('contrat', ID)).resolves.toEqual({
      type: 'foyer',
      foyerId: FOYER,
    });
  });

  it('établissement existant → portée foyer', async () => {
    const r = new ResolveurFoyerPlanification(fakeDb([{ foyerId: FOYER }]));
    await expect(r.resoudre('etablissement', ID)).resolves.toEqual({
      type: 'foyer',
      foyerId: FOYER,
    });
  });

  it('ressource inexistante → null (404 laissé au handler)', async () => {
    const r = new ResolveurFoyerPlanification(fakeDb([]));
    await expect(r.resoudre('contrat', ID)).resolves.toBeNull();
    await expect(r.resoudre('etablissement', ID)).resolves.toBeNull();
  });

  it('ressource inconnue → erreur de configuration', async () => {
    const r = new ResolveurFoyerPlanification(fakeDb([]));
    await expect(r.resoudre('parent', ID)).rejects.toThrow(
      /ressource inconnue/,
    );
  });
});
