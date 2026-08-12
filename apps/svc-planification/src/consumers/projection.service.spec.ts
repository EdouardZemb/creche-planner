import { describe, expect, it, vi } from 'vitest';
import type { Table } from 'drizzle-orm';
import {
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
  FOYER_SUPPRIME_TYPE,
} from '@creche-planner/contracts-foyer';
import { CONTRAT_MODIFIE_TYPE } from '@creche-planner/contracts-planification';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import type { ContratRow } from '../database/schema.js';
import {
  contrat,
  deadLetter,
  etablissement,
  outbox,
  processedEvent,
} from '../database/schema.js';

/**
 * Tests d'**aiguillage, d'idempotence et de ré-émission** du projecteur `FOYER`
 * côté Planification, sans Postgres. La projection effective (SQL réel) reste
 * couverte par les tests d'intégration/stack. Ici on vérifie le contrat de
 * `traiter` : enveloppes inconnues acquittées sans toucher la base, échec de
 * parsing → re-livraison (NAK), idempotence pilotée par `processed_event`, et
 * ré-émission d'un `ContratModifie` **par contrat rafraîchi**.
 *
 * Pour l'effacement (`FoyerSupprime`), ce niveau capture la **séquence** des
 * `delete` : c'est ici que se joue la contrainte d'ordre imposée par la FK
 * `contrat.etablissement_id`. L'oracle de **résidu** (« il ne reste rien ») vit
 * dans `projection.integration.spec.ts`, sur une base factice à état.
 */

const ENFANT_ID = '77777777-7777-4777-8777-777777777777';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';

/** Ligne contrat renvoyée par l'`update().returning()` (post-rafraîchissement). */
function ligneRafraichie(
  id: string,
  prenom: string,
  premiereInscription = false,
): ContratRow {
  return {
    id,
    foyerId: FOYER_ID,
    enfant: prenom,
    enfantId: ENFANT_ID,
    mode: 'CRECHE_PSU',
    etablissementId: '99999999-9999-4999-8999-999999999999',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    premiereInscription,
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
 * l'idempotence (`marqueurInsere`), l'insert `outbox` est capturé,
 * `update().set().where().returning()` renvoie les contrats « rafraîchis », et
 * `tablesSupprimees` retient les tables ciblées par un `delete` **dans l'ordre
 * d'appel** (la seule chose que ce niveau sache observer de l'effacement).
 */
function fakeDb(options: {
  marqueurInsere: boolean;
  contratsRafraichis?: ContratRow[];
}): {
  db: Database;
  updateSet: ReturnType<typeof vi.fn>;
  outboxInserts: Record<string, unknown>[];
  tablesSupprimees: Table[];
  transaction: ReturnType<typeof vi.fn>;
} {
  const updateSet = vi.fn();
  const outboxInserts: Record<string, unknown>[] = [];
  const tablesSupprimees: Table[] = [];
  const tx = {
    delete: (table: Table) => ({
      where: () => {
        tablesSupprimees.push(table);
        return Promise.resolve();
      },
    }),
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
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<void>) => {
    await cb(tx);
  });
  const db = {
    transaction,
  } as unknown as Database;
  return { db, updateSet, outboxInserts, tablesSupprimees, transaction };
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
      'IGNORE_ENVELOPPE_INVALIDE',
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
    ).resolves.toBe('IGNORE_TYPE_INCONNU');
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
    ).resolves.toBe('ECHEC_TRANSITOIRE');
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
    ).resolves.toBe('TRAITE');

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

  it('le ContratModifie ré-émis reconduit premiereInscription (lot 4a — pas de « clignotement »)', async () => {
    const { db, outboxInserts } = fakeDb({
      marqueurInsere: true,
      contratsRafraichis: [
        ligneRafraichie('55555555-5555-4555-8555-555555555555', 'Léa', true),
      ],
    });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'FOYER',
        evenementEnfantModifie('11111111-1111-4111-8111-111111111111', 'Léa'),
      ),
    ).resolves.toBe('TRAITE');

    expect(outboxInserts[0]).toMatchObject({
      type: CONTRAT_MODIFIE_TYPE,
      payload: expect.objectContaining({ premiereInscription: true }),
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
    ).resolves.toBe('TRAITE');
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
    ).resolves.toBe('TRAITE');
    expect(updateSet).not.toHaveBeenCalled();
    expect(outboxInserts).toHaveLength(0);
  });
});

/**
 * **Droit à l'effacement** (`FoyerSupprime`, doc 37 §3) — niveau aiguillage.
 *
 * L'assertion centrale ici est l'**ordre** des `delete`. `contrat.etablissement_id`
 * référence `etablissement.id` en `ON DELETE no action` (migration 0003) : vider
 * `etablissement` avant `contrat` violerait la contrainte, ferait échouer toute la
 * transaction et enverrait l'effacement en boucle de re-livraison. Aucun test de
 * contenu ne rattraperait cette inversion — seul un test d'ordre le fait.
 *
 * Symétriquement, les trois tables filles de `contrat` (`contrat_version`,
 * `correction_journal`, `planning_mois`) ne doivent **pas** apparaître dans la
 * séquence : elles sont emportées par la cascade SQL, pas par ce code.
 */
describe('ProjectionService.traiter — FoyerSupprime (effacement)', () => {
  const ID_SUPPR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function evenementFoyerSupprime(id: string): unknown {
    return {
      id,
      type: FOYER_SUPPRIME_TYPE,
      source: 'svc-foyer',
      version: 1,
      occurredAt: '2027-02-01T00:00:00.000Z',
      traceId: 'trace-suppr',
      payload: {
        foyerId: FOYER_ID,
        // Portés pour svc-notifications (boîte in-app clée par parent) ; sans
        // usage ici : aucune table de Planification n'est clée par parent.
        parentIds: [
          '77777777-0000-4000-8000-000000000001',
          '77777777-0000-4000-8000-000000000002',
        ],
      },
    };
  }

  it('aiguille le type vers l’effacement et acquitte (TRAITE)', async () => {
    const { db, transaction } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR)),
    ).resolves.toBe('TRAITE');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('cas nominal : un delete par table portant la donnée, dans l’ordre imposé par la FK', async () => {
    const { db, tablesSupprimees } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);

    await projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR));

    // `contrat` AVANT `etablissement` : l'inverse violerait
    // `contrat_etablissement_id_etablissement_id_fk` (no action).
    expect(tablesSupprimees).toEqual([contrat, etablissement, deadLetter]);
  });

  it('les tables filles en cascade SQL ne sont PAS supprimées par le code', async () => {
    const { db, tablesSupprimees } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);

    await projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR));

    // 3 tables ciblées, pas 6 : `contrat_version`, `correction_journal` et
    // `planning_mois` pendent de `contrat` en `ON DELETE cascade`.
    expect(tablesSupprimees).toHaveLength(3);
  });

  it('ni outbox ni processed_event ne sont purgées (file vivante / garde-fou anti-rejeu)', async () => {
    const { db, tablesSupprimees } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);

    await projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR));

    expect(tablesSupprimees).not.toContain(outbox);
    expect(tablesSupprimees).not.toContain(processedEvent);
  });

  it('idempotent : un rejeu (marqueur déjà présent) ne déclenche AUCUN delete, mais acquitte', async () => {
    const { db, tablesSupprimees } = fakeDb({ marqueurInsere: false });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR)),
    ).resolves.toBe('TRAITE');
    expect(tablesSupprimees).toHaveLength(0);
  });

  it('NAK (re-livraison) si le payload d’effacement est invalide', async () => {
    const { db, tablesSupprimees } = fakeDb({ marqueurInsere: true });
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('FOYER', {
        ...(evenementFoyerSupprime(ID_SUPPR) as Record<string, unknown>),
        payload: { foyerId: 'pas-un-uuid', parentIds: [] },
      }),
    ).resolves.toBe('ECHEC_TRANSITOIRE');
    expect(tablesSupprimees).toHaveLength(0);
  });
});
