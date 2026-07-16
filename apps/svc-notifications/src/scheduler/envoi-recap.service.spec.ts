import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EnvoiRecapService } from './envoi-recap.service.js';
import type { Database } from '../database/database.types.js';
import {
  envoiRecapHebdo,
  envoiRecapParent,
  type EnvoiRecapHebdoRow,
} from '../database/schema.js';

/**
 * Tests de `EnvoiRecapService` **sans Postgres** : une base factice capture les appels
 * du query builder drizzle (table, `values`, cible du `onConflictDoNothing`, `set`,
 * `where`). Le prédicat `where` est **rendu en SQL paramétré** via `PgDialect` pour
 * vérifier le cœur du Lot 3 — le filtre de reprise (`A_ENVOYER`/`ECHEC`) et surtout le
 * **compare-and-set** `statut <> 'ENVOYE'` qui empêche qu'un slot abouti soit rétrogradé.
 */

const dialect = new PgDialect();

/** Rend une condition drizzle en SQL paramétré (assertions sur les valeurs liées). */
function parametresWhere(cond: SQL | undefined): readonly unknown[] {
  if (!cond) {
    throw new Error('condition WHERE absente');
  }
  return dialect.sqlToQuery(cond).params;
}

interface OnConflictUpdate {
  target: unknown[];
  set: Record<string, unknown>;
  setWhere?: SQL | undefined;
}

interface Captures {
  insert: unknown[];
  values: Record<string, unknown>[];
  onConflictTargets: unknown[][];
  onConflictUpdates: OnConflictUpdate[];
  selectFrom: unknown[];
  updateTable: unknown[];
  set: Record<string, unknown>[];
  where: (SQL | undefined)[];
}

function fakeDb(selectRows: readonly unknown[] = []): {
  db: Database;
  calls: Captures;
} {
  const calls: Captures = {
    insert: [],
    values: [],
    onConflictTargets: [],
    onConflictUpdates: [],
    selectFrom: [],
    updateTable: [],
    set: [],
    where: [],
  };
  const db = {
    insert: (table: unknown) => {
      calls.insert.push(table);
      return {
        values: (v: Record<string, unknown>) => {
          calls.values.push(v);
          return {
            onConflictDoNothing: (opts: { target: unknown[] }) => {
              calls.onConflictTargets.push(opts.target);
              return Promise.resolve([]);
            },
            onConflictDoUpdate: (opts: OnConflictUpdate) => {
              calls.onConflictUpdates.push(opts);
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    select: () => ({
      from: (table: unknown) => {
        calls.selectFrom.push(table);
        return {
          where: (cond: SQL | undefined) => {
            calls.where.push(cond);
            return Promise.resolve(selectRows);
          },
        };
      },
    }),
    update: (table: unknown) => {
      calls.updateTable.push(table);
      return {
        set: (v: Record<string, unknown>) => {
          calls.set.push(v);
          return {
            where: (cond: SQL | undefined) => {
              calls.where.push(cond);
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Database, calls };
}

describe('EnvoiRecapService', () => {
  it('reserver : insert A_ENVOYER, onConflictDoNothing sur la PK (foyer, semaine)', async () => {
    const { db, calls } = fakeDb();

    await new EnvoiRecapService(db).reserver('foyer-1', '2026-W27');

    expect(calls.insert[0]).toBe(envoiRecapHebdo);
    expect(calls.values[0]).toEqual({
      foyerId: 'foyer-1',
      semaineIso: '2026-W27',
      statut: 'A_ENVOYER',
    });
    expect(calls.onConflictTargets[0]).toEqual([
      envoiRecapHebdo.foyerId,
      envoiRecapHebdo.semaineIso,
    ]);
  });

  it('aRetenter : select filtré sur la semaine et les statuts A_ENVOYER/ECHEC', async () => {
    const rows = [{ foyerId: 'f' } as unknown as EnvoiRecapHebdoRow];
    const { db, calls } = fakeDb(rows);

    const resultat = await new EnvoiRecapService(db).aRetenter('2026-W27');

    expect(resultat).toBe(rows);
    expect(calls.selectFrom[0]).toBe(envoiRecapHebdo);
    const params = parametresWhere(calls.where[0]);
    expect(params).toContain('2026-W27');
    expect(params).toContain('A_ENVOYER');
    expect(params).toContain('ECHEC');
    // Un slot abouti n'est jamais relu par la reprise.
    expect(params).not.toContain('ENVOYE');
    expect(params).not.toContain('DRY_RUN');
  });

  it('marquerAbouti : fige statut/preuve et garde le compare-and-set (<> ENVOYE)', async () => {
    const { db, calls } = fakeDb();

    await new EnvoiRecapService(db).marquerAbouti('foyer-1', '2026-W27', {
      statut: 'ENVOYE',
      messageId: '<m@test>',
      destinataires: ['a@test', 'b@test'],
    });

    expect(calls.updateTable[0]).toBe(envoiRecapHebdo);
    expect(calls.set[0]).toMatchObject({
      statut: 'ENVOYE',
      messageId: '<m@test>',
      destinataires: ['a@test', 'b@test'],
      erreur: null,
    });
    expect(calls.set[0]?.['envoyeLe']).toBeInstanceOf(Date);
    const params = parametresWhere(calls.where[0]);
    expect(params).toContain('foyer-1');
    expect(params).toContain('2026-W27');
    // Compare-and-set : le WHERE porte la garde `statut <> 'ENVOYE'`.
    expect(params).toContain('ENVOYE');
  });

  it('marquerEchec : bascule ECHEC + erreur, en préservant le compare-and-set', async () => {
    const { db, calls } = fakeDb();

    await new EnvoiRecapService(db).marquerEchec(
      'foyer-1',
      '2026-W27',
      'SMTP KO',
    );

    expect(calls.updateTable[0]).toBe(envoiRecapHebdo);
    expect(calls.set[0]).toMatchObject({ statut: 'ECHEC', erreur: 'SMTP KO' });
    const params = parametresWhere(calls.where[0]);
    expect(params).toContain('foyer-1');
    expect(params).toContain('2026-W27');
    expect(params).toContain('ENVOYE');
  });

  // ---- Ledger de livraison par parent (Lot L1) -----------------------------

  it('livraisonsParFoyerSemaine : Map par parentId {statut, essais}, filtrée foyer+semaine', async () => {
    const rows = [
      { parentId: 'p1', statut: 'ENVOYE', essais: 0 },
      { parentId: 'p2', statut: 'ECHEC', essais: 3 },
    ];
    const { db, calls } = fakeDb(rows);

    const map = await new EnvoiRecapService(db).livraisonsParFoyerSemaine(
      'foyer-1',
      '2026-W27',
    );

    expect(calls.selectFrom[0]).toBe(envoiRecapParent);
    const params = parametresWhere(calls.where[0]);
    expect(params).toContain('foyer-1');
    expect(params).toContain('2026-W27');
    expect(map.get('p1')).toEqual({ statut: 'ENVOYE', essais: 0 });
    expect(map.get('p2')).toEqual({ statut: 'ECHEC', essais: 3 });
    expect(map.size).toBe(2);
  });

  it('marquerParentAbouti : upsert ENVOYE, cible la PK (foyer, semaine, parent), garde <> ENVOYE/DRY_RUN', async () => {
    const { db, calls } = fakeDb();

    await new EnvoiRecapService(db).marquerParentAbouti(
      'foyer-1',
      '2026-W27',
      'p1',
      { statut: 'ENVOYE', email: 'maman@test', messageId: '<m@test>' },
    );

    expect(calls.insert[0]).toBe(envoiRecapParent);
    expect(calls.values[0]).toMatchObject({
      foyerId: 'foyer-1',
      semaineIso: '2026-W27',
      parentId: 'p1',
      statut: 'ENVOYE',
      email: 'maman@test',
      messageId: '<m@test>',
      erreur: null,
    });
    const update = calls.onConflictUpdates[0];
    expect(update?.target).toEqual([
      envoiRecapParent.foyerId,
      envoiRecapParent.semaineIso,
      envoiRecapParent.parentId,
    ]);
    expect(update?.set).toMatchObject({ statut: 'ENVOYE', erreur: null });
    // Compare-and-set : un parent déjà terminal n'est jamais rétrogradé/relivré.
    const gardes = parametresWhere(update?.setWhere);
    expect(gardes).toContain('ENVOYE');
    expect(gardes).toContain('DRY_RUN');
  });

  it('marquerParentEchec : upsert ECHEC, essais=1 à l’insert et incrément à l’update, garde préservée', async () => {
    const { db, calls } = fakeDb();

    await new EnvoiRecapService(db).marquerParentEchec(
      'foyer-1',
      '2026-W27',
      'p2',
      { email: 'papa@test', erreur: 'adresse invalide' },
    );

    expect(calls.insert[0]).toBe(envoiRecapParent);
    // Premier échec ⇒ essais = 1 à l'insert.
    expect(calls.values[0]).toMatchObject({
      parentId: 'p2',
      statut: 'ECHEC',
      email: 'papa@test',
      erreur: 'adresse invalide',
      essais: 1,
    });
    const update = calls.onConflictUpdates[0];
    expect(update?.target).toEqual([
      envoiRecapParent.foyerId,
      envoiRecapParent.semaineIso,
      envoiRecapParent.parentId,
    ]);
    expect(update?.set).toMatchObject({
      statut: 'ECHEC',
      erreur: 'adresse invalide',
    });
    // L'incrément d'essais est un fragment SQL (`essais + 1`), pas une constante.
    expect(update?.set['essais']).not.toBe(1);
    const gardes = parametresWhere(update?.setWhere);
    expect(gardes).toContain('ENVOYE');
    expect(gardes).toContain('DRY_RUN');
  });
});
