import { describe, expect, it, vi } from 'vitest';
import {
  FOYER_MIS_A_JOUR_TYPE,
  FOYER_MIS_A_JOUR_V2_TYPE,
} from '@creche-planner/contracts-foyer';
import {
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  PLANNING_MODIFIE_TYPE,
} from '@creche-planner/contracts-planification';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import type { PlanificationClient } from '../fallback/planification.client.js';

/**
 * Tests d'**aiguillage et d'idempotence** du projecteur, sans Postgres. La
 * projection effective (upserts SQL) est couverte par la vérification Pact provider
 * (base réelle en CI) ; ici on vérifie le contrat de `traiter` : enveloppes
 * inconnues acquittées sans toucher la base, échec de parsing → re-livraison
 * (NAK), idempotence pilotée par `processed_event` (insert `onConflictDoNothing`).
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
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
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

const clientStub = {
  prestations: vi.fn(),
} as unknown as PlanificationClient;

/**
 * Base factice pour `PlanningModifie` : `select().from().where()` renvoie `dejaVu`
 * (une ligne ⇒ événement déjà traité, court-circuit ; vide ⇒ première réception).
 * `transaction` reste observable pour vérifier qu'aucune transaction n'est ouverte
 * sur un doublon.
 */
function fakeDbProcessed(dejaVu: boolean): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dejaVu ? [{ id: 'x' }] : []),
      }),
    }),
    transaction: vi.fn(),
  } as unknown as Database;
}

function evenementPlanning(id: string): unknown {
  return {
    id,
    type: PLANNING_MODIFIE_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-01T00:00:00.000Z',
    traceId: 'trace-2',
    payload: {
      contratId: '55555555-0000-4000-8000-000000000000',
      mois: '2026-10',
      simule: false,
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
    traceId: 'trace-3',
    payload: {
      contratId: '55555555-0000-4000-8000-000000000000',
      foyerId: '22222222-2222-4222-8222-222222222222',
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
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
    traceId: 'trace-4',
    payload: {
      contratId: '55555555-0000-4000-8000-000000000000',
    },
  };
}

function evenementFoyer(id: string): unknown {
  return {
    id,
    type: FOYER_MIS_A_JOUR_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-01T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      foyerId: '22222222-2222-4222-8222-222222222222',
      ressourcesMensuellesCentimes: 671692,
      rfrCentimes: 7270500,
      nbEnfantsACharge: 2,
      nbParts: 3,
      tranche: 3,
    },
  };
}

/**
 * Variante **v2 rétrocompatible** de `foyer.FoyerMisAJour` (DEC-02) : enveloppe
 * `version: 2`, `type` `.v2`, et le champ optionnel `anneeRevenus` dans le payload.
 */
function evenementFoyerV2(id: string): unknown {
  return {
    id,
    type: FOYER_MIS_A_JOUR_V2_TYPE,
    source: 'svc-foyer',
    version: 2,
    occurredAt: '2026-09-01T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      foyerId: '22222222-2222-4222-8222-222222222222',
      ressourcesMensuellesCentimes: 671692,
      rfrCentimes: 7270500,
      nbEnfantsACharge: 2,
      nbParts: 3,
      tranche: 3,
      anneeRevenus: 2024,
    },
  };
}

describe('ProjectionService.traiter', () => {
  it('acquitte une enveloppe non reconnue sans toucher la base', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(projection.traiter('FOYER', { foo: 'bar' })).resolves.toBe(
      true,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('acquitte un type d’événement non consommé par Tarification', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter('AUTRE', { type: 'autre.Chose.v1' }),
    ).resolves.toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('NAK (re-livraison) si le payload est invalide', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter('FOYER', {
        ...(evenementFoyer('11111111-1111-4111-8111-111111111111') as Record<
          string,
          unknown
        >),
        payload: { foyerId: 'pas-un-uuid' },
      }),
    ).resolves.toBe(false);
  });

  it('projette un FoyerMisAJour valide (1ʳᵉ réception) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter(
        'FOYER',
        evenementFoyer('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('décode un FoyerMisAJour.v2 (dispatch par version) et projette comme v1', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter(
        'FOYER',
        evenementFoyerV2('77777777-7777-4777-8777-777777777777'),
      ),
    ).resolves.toBe(true);
    // Même projection que v1 : une transaction ouverte, aucune régression.
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('rétro-compat : un FoyerMisAJour.v1 historique reste décodable après l’ajout de v2', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter(
        'FOYER',
        evenementFoyer('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('NAK si un payload v2 est invalide (anneeRevenus hors borne)', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    const base = evenementFoyerV2(
      '77777777-7777-4777-8777-777777777777',
    ) as Record<string, unknown>;
    await expect(
      projection.traiter('FOYER', {
        ...base,
        payload: {
          ...(base['payload'] as Record<string, unknown>),
          anneeRevenus: 1700,
        },
      }),
    ).resolves.toBe(false);
  });

  it('idempotent : un doublon (marqueur déjà présent) n’upsert pas mais acquitte', async () => {
    const db = fakeDb(false); // marquerTraite renvoie vide ⇒ doublon
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter(
        'FOYER',
        evenementFoyer('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
  });

  it('projette un ContratModifie valide (met à jour identité) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratModifie('44444444-4444-4444-8444-444444444444'),
      ),
    ).resolves.toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('projette un ContratSupprime valide (supprime contrat + prestations) et acquitte', async () => {
    const db = fakeDb(true);
    const projection = new ProjectionService(db, clientStub);
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
    const projection = new ProjectionService(db, clientStub);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime('66666666-6666-4666-8666-666666666666'),
      ),
    ).resolves.toBe(true);
  });

  it('PlanningModifie déjà traité : court-circuit, ACK sans appel réseau de repli', async () => {
    const db = fakeDbProcessed(true); // dejaTraite ⇒ true
    const client = { prestations: vi.fn() } as unknown as PlanificationClient;
    const projection = new ProjectionService(db, client);
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementPlanning('33333333-3333-4333-8333-333333333333'),
      ),
    ).resolves.toBe(true);
    // L'optimisation : pas de fetch des prestations sur un rejeu déjà projeté.
    expect(client.prestations).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
