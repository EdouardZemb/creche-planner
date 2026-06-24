import { describe, expect, it } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
} from '@creche-planner/contracts-planification';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import { contrat, processedEvent } from '../database/schema.js';

/**
 * Test d'**intégration** de la chaîne « événement → projection » du read model
 * Notifications : contrairement à `projection.service.spec.ts` (aiguillage, fakes
 * sans état), on vérifie ici le **contenu du read model `contrat`** après traitement,
 * l'**idempotence rejouée** (même enveloppe ré-livrée ⇒ no-op), la mise à jour par
 * `ContratModifie` et la suppression par `ContratSupprime` — sans Postgres.
 *
 * La base factice est **à état** : un magasin de lignes par table Drizzle, qui honore
 * le sous-ensemble utilisé par la projection — `select().from().where(eq)`,
 * `insert().values().onConflictDoNothing().returning()` (marqueur d'idempotence),
 * `insert().values().onConflictDoUpdate()` (upsert), `delete().where(eq)`. Les
 * conditions `eq(colonne, valeur)` sont évaluées en lisant les `queryChunks` drizzle
 * (colonne + paramètre lié) ; seul ce prédicat est supporté.
 */

type Ligne = Record<string, unknown>;

function fakeBaseEnMemoire(): {
  db: Database;
  lignesDe: (t: Table) => Ligne[];
} {
  const magasin = new Map<Table, Ligne[]>();
  const lignesDe = (table: Table): Ligne[] => {
    let lignes = magasin.get(table);
    if (!lignes) {
      lignes = [];
      magasin.set(table, lignes);
    }
    return lignes;
  };
  /** Nom de propriété TS d'une colonne dans sa table (ex. `contrat_id` → `contratId`). */
  const cleDe = (table: Table, colonne: Column): string => {
    const entree = Object.entries(getTableColumns(table)).find(
      ([, c]) => c === colonne,
    );
    if (!entree) {
      throw new Error(`colonne inconnue dans la table : ${colonne.name}`);
    }
    return entree[0];
  };
  /** Évalue un `eq(colonne, valeur)` (seul prédicat utilisé par la projection). */
  const filtreEq = (table: Table, condition: unknown) => {
    const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
    const colonne = chunks.find((c) => c instanceof Column) as Column;
    const param = chunks.find((c) => c instanceof Param) as Param;
    const cle = cleDe(table, colonne);
    return (ligne: Ligne) => ligne[cle] === param.value;
  };
  const clefConflit = (table: Table, cibles: Column[], ligne: Ligne): string =>
    cibles.map((c) => String(ligne[cleDe(table, c)])).join('|');

  const operations = {
    select: () => ({
      from: (table: Table) => ({
        where: (condition: unknown) =>
          Promise.resolve(lignesDe(table).filter(filtreEq(table, condition))),
      }),
    }),
    insert: (table: Table) => ({
      values: (valeurs: Ligne) => ({
        // Marqueur d'idempotence : n'insère que si la clé est nouvelle.
        onConflictDoNothing: (opts: { target: Column }) => ({
          returning: () => {
            const clef = clefConflit(table, [opts.target], valeurs);
            const doublon = lignesDe(table).some(
              (l) => clefConflit(table, [opts.target], l) === clef,
            );
            if (doublon) {
              return Promise.resolve([]);
            }
            lignesDe(table).push({ ...valeurs });
            return Promise.resolve([{ id: valeurs['id'] }]);
          },
        }),
        // Upsert de projection : remplace sur conflit de clé (simple ou composite).
        onConflictDoUpdate: (opts: {
          target: Column | Column[];
          set: Ligne;
        }) => {
          const cibles = Array.isArray(opts.target)
            ? opts.target
            : [opts.target];
          const clef = clefConflit(table, cibles, valeurs);
          const existante = lignesDe(table).find(
            (l) => clefConflit(table, cibles, l) === clef,
          );
          if (existante) {
            Object.assign(existante, opts.set);
          } else {
            lignesDe(table).push({ ...valeurs });
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: Table) => ({
      where: (condition: unknown) => {
        const lignes = lignesDe(table);
        const restantes = lignes.filter((l) => !filtreEq(table, condition)(l));
        lignes.splice(0, lignes.length, ...restantes);
        return Promise.resolve();
      },
    }),
  };

  const db = {
    ...operations,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(operations),
  } as unknown as Database;

  return { db, lignesDe };
}

const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';

function evenementContratCree(
  id: string,
  surcharge: Record<string, unknown> = {},
): unknown {
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
      ...surcharge,
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
    occurredAt: '2026-10-15T00:00:00.000Z',
    traceId: 'trace-3',
    payload: { contratId: CONTRAT_ID },
  };
}

describe('Projection ContratCree (contenu + idempotence rejouée)', () => {
  const ID_EVT = '11111111-1111-4111-8111-111111111111';

  it('projette l’identité et la période de validité dans le read model contrat', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT)),
    ).resolves.toBe(true);

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('idempotence REJOUÉE : la même enveloppe ré-livrée (at-least-once) est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT));

    // Rejeu de la MÊME enveloppe (même id) avec un payload altéré : si la
    // projection était ré-appliquée, l'enfant changerait.
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratCree(ID_EVT, { enfant: 'Zoé' }),
      ),
    ).resolves.toBe(true);

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({ enfant: 'Mia' }); // 1ʳᵉ livraison conservée
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('un ContratModifie (id différent) met à jour le contrat existant (upsert)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT));

    await projection.traiter(
      'PLANIFICATION',
      evenementContratModifie('22222222-2222-4222-8222-aaaaaaaaaaaa'),
    );

    expect(lignesDe(contrat)).toHaveLength(1); // toujours une seule ligne par contrat
    expect(lignesDe(contrat)[0]).toMatchObject({
      mode: 'PERISCOLAIRE',
      valideAu: '2026-12-31',
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('événement de type inconnu : acquitté sans RIEN projeter ni marquer', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('PLANIFICATION', {
        id: ID_EVT,
        type: 'planification.PlanningModifie.v1',
        payload: {},
      }),
    ).resolves.toBe(true);
    expect(lignesDe(contrat)).toHaveLength(0);
    expect(lignesDe(processedEvent)).toHaveLength(0);
  });
});

describe('Projection ContratSupprime', () => {
  const ID_EVT_CREE = '33333333-3333-4333-8333-333333333333';
  const ID_EVT_SUPPR = '44444444-4444-4444-8444-444444444444';

  it('supprime le contrat projeté ; le rejeu de la suppression est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CREE),
    );
    expect(lignesDe(contrat)).toHaveLength(1);

    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime(ID_EVT_SUPPR),
      ),
    ).resolves.toBe(true);
    expect(lignesDe(contrat)).toHaveLength(0);

    // Rejeu de la MÊME suppression (même id) : marqueur déjà posé ⇒ no-op.
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime(ID_EVT_SUPPR),
      ),
    ).resolves.toBe(true);
    expect(lignesDe(contrat)).toHaveLength(0);
    expect(
      lignesDe(processedEvent).filter((l) => l['id'] === ID_EVT_SUPPR),
    ).toHaveLength(1);
  });
});
