import { describe, expect, it, vi } from 'vitest';
import {
  BAREME_TRANCHES_PUBLIE_TYPE,
  REFERENTIEL_EVENT_SOURCE,
} from '@creche-planner/contracts-referentiel';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';

/**
 * Tests unitaires de la `ProjectionService` de svc-foyer (première infra de
 * consommation, SFD 30 lot 3) SANS infra : faux `db` transactionnel espionnable.
 * On couvre le dispatch par type, l'idempotence (marqueur `processed_event` dans la
 * transaction) et la robustesse (enveloppe invalide, type inconnu, échec transitoire).
 * Le SQL réel (upsert `bareme_tranches`) reste couvert par les specs d'intégration.
 */

const BAREME_ID = '11111111-0000-4000-8000-000000000000';

/** Enveloppe `BaremeTranchesPublie.v1` valide. */
function enveloppeBareme(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: '22222222-0000-4000-8000-000000000000',
    type: BAREME_TRANCHES_PUBLIE_TYPE,
    version: 1,
    source: REFERENTIEL_EVENT_SOURCE,
    occurredAt: '2026-01-01T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      baremeId: BAREME_ID,
      valideDu: '2026-01-01',
      valideAu: null,
      seuils: [
        { niveau: 1, rfrMaxCentimes: 1999999 },
        { niveau: 2, rfrMaxCentimes: 5000000 },
        { niveau: 3, rfrMaxCentimes: null },
      ],
    },
    ...overrides,
  };
}

/**
 * Faux `db` transactionnel : `insert(processed_event)...returning()` renvoie une
 * ligne (non doublon) ou `[]` (doublon → projection sautée) selon `doublon`.
 */
function fakeDb(options: { doublon?: boolean } = {}): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn((valeurs: Record<string, unknown>) => {
    const estMarqueur = typeof valeurs['stream'] === 'string';
    return Object.assign(Promise.resolve(), {
      returning: () =>
        Promise.resolve(estMarqueur && options.doublon ? [] : [{ id: 'x' }]),
      onConflictDoNothing: () => ({
        returning: () =>
          Promise.resolve(estMarqueur && options.doublon ? [] : [{ id: 'x' }]),
      }),
      onConflictDoUpdate: () => Promise.resolve(),
    });
  });
  const tx = { insert: () => ({ values: insertValues }) };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues };
}

describe('ProjectionService (svc-foyer, barème de tranches)', () => {
  it('projette BaremeTranchesPublie.v1 (marqueur + upsert dans la transaction)', async () => {
    const { db, transaction, insertValues } = fakeDb();
    const service = new ProjectionService(db);

    const res = await service.traiter('REFERENTIEL', enveloppeBareme());

    expect(res).toBe('TRAITE');
    expect(transaction).toHaveBeenCalledTimes(1);
    // Upsert du barème avec les seuils du payload.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: BAREME_ID,
        valideDu: '2026-01-01',
        seuils: expect.any(Array),
      }),
    );
  });

  it('doublon (marqueur déjà présent) → projection sautée, TRAITE', async () => {
    const { db, insertValues } = fakeDb({ doublon: true });
    const service = new ProjectionService(db);

    const res = await service.traiter('REFERENTIEL', enveloppeBareme());

    expect(res).toBe('TRAITE');
    // Seul le marqueur est tenté ; pas d'upsert de barème.
    const upserts = insertValues.mock.calls.filter(
      (c) => (c[0] as { seuils?: unknown }).seuils !== undefined,
    );
    expect(upserts).toHaveLength(0);
  });

  it('enveloppe sans type → IGNORE_ENVELOPPE_INVALIDE', async () => {
    const { db } = fakeDb();
    const service = new ProjectionService(db);
    expect(await service.traiter('REFERENTIEL', {})).toBe(
      'IGNORE_ENVELOPPE_INVALIDE',
    );
  });

  it('type non consommé → IGNORE_TYPE_INCONNU', async () => {
    const { db } = fakeDb();
    const service = new ProjectionService(db);
    expect(
      await service.traiter(
        'REFERENTIEL',
        enveloppeBareme({ type: 'referentiel.Autre.v1' }),
      ),
    ).toBe('IGNORE_TYPE_INCONNU');
  });

  it('payload invalide → ECHEC_TRANSITOIRE (re-livraison)', async () => {
    const { db } = fakeDb();
    const service = new ProjectionService(db);
    const res = await service.traiter(
      'REFERENTIEL',
      enveloppeBareme({ payload: { baremeId: 'pas-un-uuid' } }),
    );
    expect(res).toBe('ECHEC_TRANSITOIRE');
  });

  it('dejaTraite interroge processed_event', async () => {
    const select = vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve([{ id: 'x' }]) }),
    }));
    const db = { select } as unknown as Database;
    const service = new ProjectionService(db);
    expect(await service.dejaTraite('x')).toBe(true);
  });
});
