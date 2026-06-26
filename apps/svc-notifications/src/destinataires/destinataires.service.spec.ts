import { describe, expect, it } from 'vitest';
import { DestinatairesService } from './destinataires.service.js';
import type { Database } from '../database/database.types.js';
import type { FoyerParentRow } from '../database/schema.js';

/**
 * Tests du service de résolution des destinataires, sans Postgres : le filtre
 * `foyer + actif` est délégué à SQL (non évalué ici) ; la base factice renvoie le jeu
 * fourni. On vérifie donc le **tri** (principal d'abord puis e-mail) et le **mapping**
 * vers les seuls e-mails, ainsi que le cas vide (qui déclenchera le repli côté scheduler).
 */

function ligne(partiel: Partial<FoyerParentRow> = {}): FoyerParentRow {
  return {
    parentId: '88888888-8888-4888-8888-888888888888',
    foyerId: '22222222-2222-4222-8222-222222222222',
    email: 'parent@test',
    principal: false,
    actif: true,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partiel,
  };
}

function fakeBase(lignes: FoyerParentRow[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(lignes),
      }),
    }),
  } as unknown as Database;
}

const FOYER = '22222222-2222-4222-8222-222222222222';

describe('DestinatairesService.emailsActifs', () => {
  it('place le principal en tête puis trie par e-mail', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ email: 'zoe@test', principal: false }),
        ligne({ email: 'papa@test', principal: false }),
        ligne({ email: 'maman@test', principal: true }),
      ]),
    );

    await expect(service.emailsActifs(FOYER)).resolves.toEqual([
      'maman@test',
      'papa@test',
      'zoe@test',
    ]);
  });

  it('foyer sans parent actif : liste vide (repli côté appelant)', async () => {
    const service = new DestinatairesService(fakeBase([]));
    await expect(service.emailsActifs(FOYER)).resolves.toEqual([]);
  });

  it('un seul parent : sa seule adresse', async () => {
    const service = new DestinatairesService(
      fakeBase([ligne({ email: 'seul@test' })]),
    );
    await expect(service.emailsActifs(FOYER)).resolves.toEqual(['seul@test']);
  });
});
