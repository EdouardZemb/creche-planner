import { describe, expect, it, vi } from 'vitest';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
} from '@creche-planner/contracts-planification';
import {
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
} from '@creche-planner/contracts-foyer';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';

/**
 * Tests d'**aiguillage et d'idempotence** du projecteur Notifications, sans Postgres.
 * La projection effective (upserts/suppressions SQL) est couverte par
 * `projection.integration.spec.ts` (base factice à état) ; ici on vérifie le contrat
 * de `traiter` : enveloppes inconnues acquittées sans toucher la base, échec de
 * parsing → re-livraison (NAK), idempotence pilotée par `processed_event` (insert
 * `onConflictDoNothing`).
 */

/**
 * Base factice : `transaction` (un mock vitest, pour pouvoir l'observer) exécute le
 * callback avec un `tx` instrumenté. `marqueurInsere` pilote le retour de
 * `marquerTraite` : `returning()` non vide ⇒ 1ʳᵉ réception ; vide ⇒ doublon.
 */
function fakeDb(marqueurInsere: boolean): Database {
  const tx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(marqueurInsere ? [{ id: 'x' }] : []),
        }),
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  return {
    transaction: vi.fn(
      async (cb: (t: unknown) => Promise<void>): Promise<void> => {
        await cb(tx);
      },
    ),
  } as unknown as Database;
}

const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';

function evenementContratCree(id: string): unknown {
  return {
    id,
    type: CONTRAT_CREE_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
    },
  };
}

function evenementContratModifie(id: string): unknown {
  return {
    id,
    type: CONTRAT_MODIFIE_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-01T00:00:00.000Z',
    traceId: 'trace-2',
    payload: {
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'PERISCOLAIRE',
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
    },
  };
}

function evenementContratSupprime(id: string): unknown {
  return {
    id,
    type: CONTRAT_SUPPRIME_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-01T00:00:00.000Z',
    traceId: 'trace-3',
    payload: { contratId: CONTRAT_ID },
  };
}

const PARENT_ID = '88888888-8888-4888-8888-888888888888';

function evenementParent(type: string, id: string): unknown {
  return {
    id,
    type,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-p',
    payload: {
      foyerId: FOYER_ID,
      parentId: PARENT_ID,
      email: 'maman@test.fr',
      principal: true,
      actif: true,
    },
  };
}

function evenementParentRetire(id: string): unknown {
  return {
    id,
    type: PARENT_RETIRE_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-16T00:00:00.000Z',
    traceId: 'trace-pr',
    payload: { foyerId: FOYER_ID, parentId: PARENT_ID },
  };
}

const ETAB_ID = '99999999-9999-4999-8999-999999999999';

function evenementEtablissement(type: string, id: string): unknown {
  return {
    id,
    type,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-e',
    payload: {
      etablissementId: ETAB_ID,
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
      emailService: 'creche@test.fr',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      types: ['CRECHE_PSU'],
      actif: true,
    },
  };
}

function evenementEtablissementSupprime(id: string): unknown {
  return {
    id,
    type: ETABLISSEMENT_SUPPRIME_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-09-16T00:00:00.000Z',
    traceId: 'trace-es',
    payload: { etablissementId: ETAB_ID },
  };
}

describe('ProjectionService.traiter (Notifications)', () => {
  it('acquitte une enveloppe non reconnue sans toucher la base', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('PLANIFICATION', { foo: 'bar' }),
    ).resolves.toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('acquitte un type d’événement non consommé par Notifications', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('PLANIFICATION', {
        type: 'planification.PlanningModifie.v1',
      }),
    ).resolves.toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('NAK (re-livraison) si le payload ContratCree est invalide', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('PLANIFICATION', {
        ...(evenementContratCree(
          '11111111-1111-4111-8111-111111111111',
        ) as Record<string, unknown>),
        payload: { contratId: 'pas-un-uuid' },
      }),
    ).resolves.toBe(false);
  });

  it('projette un ContratCree valide (1ʳᵉ réception) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratCree('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('idempotent : un ContratCree doublon (marqueur déjà présent) n’upsert pas mais acquitte', async () => {
    const db = fakeDb(false); // marquerTraite renvoie vide ⇒ doublon
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratCree('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un ContratModifie valide (met à jour identité) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratModifie('44444444-4444-4444-8444-444444444444'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un ContratSupprime valide (supprime le contrat) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime('66666666-6666-4666-8666-666666666666'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('ContratSupprime doublon (marqueur présent) : pas de suppression, acquitté', async () => {
    const db = fakeDb(false); // marquerTraite renvoie vide ⇒ doublon
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime('66666666-6666-4666-8666-666666666666'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un ParentAjoute valide (stream FOYER) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'FOYER',
        evenementParent(
          PARENT_AJOUTE_TYPE,
          '11111111-1111-4111-8111-111111111111',
        ),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un ParentModifie valide (même payload d’état) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'FOYER',
        evenementParent(
          PARENT_MODIFIE_TYPE,
          '22222222-2222-4222-8222-aaaaaaaaaaaa',
        ),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('applique un ParentRetire valide (soft-delete) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'FOYER',
        evenementParentRetire('33333333-3333-4333-8333-333333333333'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('NAK (re-livraison) si le payload ParentAjoute est invalide', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('FOYER', {
        ...(evenementParent(
          PARENT_AJOUTE_TYPE,
          '44444444-4444-4444-8444-444444444444',
        ) as Record<string, unknown>),
        payload: { foyerId: 'pas-un-uuid' },
      }),
    ).resolves.toBe(false);
  });

  it('idempotent : un ParentAjoute doublon (marqueur présent) n’upsert pas mais acquitte', async () => {
    const db = fakeDb(false); // marquerTraite renvoie vide ⇒ doublon
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'FOYER',
        evenementParent(
          PARENT_AJOUTE_TYPE,
          '55555555-5555-4555-8555-555555555555',
        ),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un EtablissementCree valide (stream PLANIFICATION) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissement(
          ETABLISSEMENT_CREE_TYPE,
          '11111111-1111-4111-8111-eeeeeeeeeeee',
        ),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un EtablissementModifie valide (même payload d’état) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissement(
          ETABLISSEMENT_MODIFIE_TYPE,
          '22222222-2222-4222-8222-eeeeeeeeeeee',
        ),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('applique un EtablissementSupprime valide (delete) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissementSupprime('33333333-3333-4333-8333-eeeeeeeeeeee'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('NAK (re-livraison) si le payload EtablissementCree est invalide', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('PLANIFICATION', {
        ...(evenementEtablissement(
          ETABLISSEMENT_CREE_TYPE,
          '44444444-4444-4444-8444-eeeeeeeeeeee',
        ) as Record<string, unknown>),
        payload: { etablissementId: 'pas-un-uuid' },
      }),
    ).resolves.toBe(false);
  });

  it('idempotent : un EtablissementCree doublon (marqueur présent) n’upsert pas mais acquitte', async () => {
    const db = fakeDb(false); // marquerTraite renvoie vide ⇒ doublon
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissement(
          ETABLISSEMENT_CREE_TYPE,
          '55555555-5555-4555-8555-eeeeeeeeeeee',
        ),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
