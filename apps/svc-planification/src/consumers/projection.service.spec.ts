import { describe, expect, it, vi } from 'vitest';
import {
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
} from '@creche-planner/contracts-foyer';
import { CONTRAT_MODIFIE_TYPE } from '@creche-planner/contracts-planification';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import type { ContratRow } from '../database/schema.js';
import { outbox, processedEvent } from '../database/schema.js';

/**
 * Tests d'**aiguillage, d'idempotence et de ré-émission** du projecteur `FOYER`
 * côté Planification, sans Postgres. La projection effective (SQL réel) reste
 * couverte par les tests d'intégration/stack. Ici on vérifie le contrat de
 * `traiter` : enveloppes inconnues acquittées sans toucher la base, échec de
 * parsing → re-livraison (NAK), idempotence pilotée par `processed_event`, et
 * ré-émission d'un `ContratModifie` **par contrat rafraîchi**.
 */

const ENFANT_ID = '77777777-7777-4777-8777-777777777777';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';

/** Ligne contrat renvoyée par l'`update().returning()` (post-rafraîchissement). */
function ligneRafraichie(id: string, prenom: string): ContratRow {
  return {
    id,
    foyerId: FOYER_ID,
    enfant: prenom,
    enfantId: ENFANT_ID,
    mode: 'CRECHE_PSU',
    etablissementId: '99999999-9999-4999-8999-999999999999',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: null,
    semaineAbcm: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Base factice discriminée **par table** : l'insert `processed_event` pilote
 * l'idempotence (`marqueurInsere`), l'insert `outbox` est capturé, et
 * `update().set().where().returning()` renvoie les contrats « rafraîchis ».
 */
function fakeDb(options: {
  marqueurInsere: boolean;
  contratsRafraichis?: ContratRow[];
}): {
  db: Database;
  updateSet: ReturnType<typeof vi.fn>;
  outboxInserts: Record<string, unknown>[];
} {
  const updateSet = vi.fn();
  const outboxInserts: Record<string, unknown>[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === processedEvent) {
          return {
            onConflictDoNothing: () => ({
              returning: () =>
                Promise.resolve(options.marqueurInsere ? [{ id: 'x' }] : []),
            }),
          };
        }
        if (table === outbox) {
          outboxInserts.push(v);
        }
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        updateSet(v);
        return {
          where: () => ({
            returning: () => Promise.resolve(options.contratsRafraichis ?? []),
          }),
        };
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => {
      await cb(tx);
    }),
  } as unknown as Database;
  return { db, updateSet, outboxInserts };
}

function evenementEnfantModifie(id: string, prenom = 'Léa'): unknown {
  return {
    id,
    type: ENFANT_MODIFIE_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-01T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      foyerId: FOYER_ID,
      enfantId: ENFANT_ID,
      prenom,
      dateNaissance: '2024-12-08',
    },
  };
}

describe('ProjectionService.traiter (svc-planification, stream FOYER)', () => {
  it('acquitte une enveloppe non reconnue sans toucher la base', async () => {
    const { db } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);
    await expect(projection.traiter('FOYER', { foo: 'bar' })).resolves.toBe(
      true,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('acquitte un type non consommé (ex. EnfantAjoute) sans toucher la base', async () => {
    const { db } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('FOYER', {
        type: ENFANT_AJOUTE_TYPE,
      }),
    ).resolves.toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('NAK (re-livraison) si le payload est invalide', async () => {
    const { db } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);
    await expect(
      projection.traiter('FOYER', {
        ...(evenementEnfantModifie(
          '11111111-1111-4111-8111-111111111111',
        ) as Record<string, unknown>),
        payload: { enfantId: 'pas-un-uuid' },
      }),
    ).resolves.toBe(false);
  });

  it('rafraîchit le prénom des contrats de l’enfant et ré-émet un ContratModifie PAR contrat', async () => {
    const { db, updateSet, outboxInserts } = fakeDb({
      marqueurInsere: true,
      contratsRafraichis: [
        ligneRafraichie('55555555-5555-4555-8555-555555555555', 'Léa'),
        ligneRafraichie('44444444-4444-4444-8444-444444444444', 'Léa'),
      ],
    });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'FOYER',
        evenementEnfantModifie('11111111-1111-4111-8111-111111111111', 'Léa'),
      ),
    ).resolves.toBe(true);

    // Le prénom dénormalisé est mis à jour (l'update filtre par enfant_id + prénom ≠).
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ enfant: 'Léa' }),
    );
    // Un ContratModifie par contrat touché, prénom rafraîchi + lien enfantId.
    expect(outboxInserts).toHaveLength(2);
    expect(outboxInserts[0]).toMatchObject({
      type: CONTRAT_MODIFIE_TYPE,
      payload: expect.objectContaining({
        contratId: '55555555-5555-4555-8555-555555555555',
        enfant: 'Léa',
        enfantId: ENFANT_ID,
      }),
    });
  });

  it('aucun contrat à rafraîchir (prénom déjà à jour ou enfant sans contrat) : acquitte sans événement', async () => {
    const { db, outboxInserts } = fakeDb({
      marqueurInsere: true,
      contratsRafraichis: [],
    });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'FOYER',
        evenementEnfantModifie('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
    expect(outboxInserts).toHaveLength(0);
  });

  it('idempotent : un doublon (marqueur déjà présent) ne met pas à jour et ne ré-émet rien, mais acquitte', async () => {
    const { db, updateSet, outboxInserts } = fakeDb({
      marqueurInsere: false, // marquerTraite renvoie vide ⇒ doublon
      contratsRafraichis: [
        ligneRafraichie('55555555-5555-4555-8555-555555555555', 'Léa'),
      ],
    });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'FOYER',
        evenementEnfantModifie('11111111-1111-4111-8111-111111111111'),
      ),
    ).resolves.toBe(true);
    expect(updateSet).not.toHaveBeenCalled();
    expect(outboxInserts).toHaveLength(0);
  });
});
