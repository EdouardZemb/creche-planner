import { describe, expect, it } from 'vitest';
import { ResolveurFoyerNotifications } from './resolveur-foyer.js';
import type { Database } from '../database/database.types.js';

const FOYER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ID = '11111111-1111-4111-8111-111111111111';

/** Base factice : `select({...}).from().where().limit()` → `rows` (0 ou 1 ligne). */
function fakeDb(rows: readonly Record<string, string>[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  } as unknown as Database;
}

describe('ResolveurFoyerNotifications', () => {
  it('contrat existant → portée foyer', async () => {
    const r = new ResolveurFoyerNotifications(fakeDb([{ foyerId: FOYER }]));
    await expect(r.resoudre('contrat', ID)).resolves.toEqual({
      type: 'foyer',
      foyerId: FOYER,
    });
  });

  it('parent existant → portée propriétaire (e-mail)', async () => {
    const r = new ResolveurFoyerNotifications(
      fakeDb([{ email: 'Alex@Exemple.FR' }]),
    );
    await expect(r.resoudre('parent', ID)).resolves.toEqual({
      type: 'proprietaire',
      email: 'Alex@Exemple.FR',
    });
  });

  it('ressource inexistante → null (404 / inbox vide laissé au handler)', async () => {
    const r = new ResolveurFoyerNotifications(fakeDb([]));
    await expect(r.resoudre('contrat', ID)).resolves.toBeNull();
    await expect(r.resoudre('parent', ID)).resolves.toBeNull();
  });

  it('ressource inconnue → erreur de configuration', async () => {
    const r = new ResolveurFoyerNotifications(fakeDb([]));
    await expect(r.resoudre('etablissement', ID)).rejects.toThrow(
      /ressource inconnue/,
    );
  });
});
