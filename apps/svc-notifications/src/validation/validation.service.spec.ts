import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import { ValidationService } from './validation.service.js';
import type { PlanificationClient } from '../fallback/planification.client.js';
import type { Database } from '../database/database.types.js';
import { notificationHebdo } from '../database/schema.js';

/**
 * Tests du service de validation hebdo **sans Postgres** : base factice à état qui
 * honore le sous-ensemble utilisé — `insert().values().onConflictDoNothing(target[]).returning()`
 * (idempotence + signal exactly-once du scheduler), `select().from().where(and(eq…))`,
 * `update().set().where(and(eq…))`. Les prédicats `and(eq(col,val))` sont évalués en
 * lisant récursivement les `queryChunks` drizzle (colonne + paramètre lié). Le client
 * de relecture du planning est mocké (vitest) pour piloter le diff.
 */
type Ligne = Record<string, unknown>;

/** Nom de propriété TS d'une colonne dans sa table (ex. `contrat_id` → `contratId`). */
function cleDe(table: Table, colonne: Column): string {
  const entree = Object.entries(getTableColumns(table)).find(
    ([, c]) => c === colonne,
  );
  if (!entree) {
    throw new Error(`colonne inconnue : ${colonne.name}`);
  }
  return entree[0];
}

/** Extrait récursivement les égalités `eq(colonne, valeur)` d'un `and(...)`/`eq`. */
function pairesEq(
  condition: unknown,
  table: Table,
): { cle: string; valeur: unknown }[] {
  const paires: { cle: string; valeur: unknown }[] = [];
  const visiter = (noeud: unknown): void => {
    const chunks = (noeud as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) {
      return;
    }
    let colonne: Column | undefined;
    let param: Param | undefined;
    for (const chunk of chunks) {
      if (chunk instanceof Column) {
        colonne = chunk;
      } else if (chunk instanceof Param) {
        param = chunk;
      } else if (
        chunk &&
        typeof chunk === 'object' &&
        Array.isArray((chunk as { queryChunks?: unknown[] }).queryChunks)
      ) {
        visiter(chunk);
      }
    }
    if (colonne && param) {
      paires.push({ cle: cleDe(table, colonne), valeur: param.value });
    }
  };
  visiter(condition);
  return paires;
}

const DEFAUTS: Ligne = {
  notifieeLe: new Date('2026-06-23T06:00:00.000Z'),
  valideeLe: null,
  deltaModifs: null,
  createdAt: new Date('2026-06-23T06:00:00.000Z'),
  updatedAt: new Date('2026-06-23T06:00:00.000Z'),
};

function fakeBase(): { db: Database; lignes: Ligne[] } {
  const lignes: Ligne[] = [];
  const filtrer = (condition: unknown): Ligne[] => {
    const paires = pairesEq(condition, notificationHebdo);
    return lignes.filter((l) => paires.every((p) => l[p.cle] === p.valeur));
  };
  const db = {
    insert: () => ({
      values: (valeurs: Ligne) => ({
        onConflictDoNothing: (opts: { target: Column | Column[] }) => {
          const cibles = Array.isArray(opts.target)
            ? opts.target
            : [opts.target];
          const cle = (l: Ligne) =>
            cibles.map((c) => l[cleDe(notificationHebdo, c)]).join('|');
          const clef = cle(valeurs);
          const existe = lignes.some((l) => cle(l) === clef);
          if (!existe) {
            lignes.push({ ...DEFAUTS, ...valeurs });
          }
          // `returning()` ne renvoie la ligne que si elle vient d'être insérée
          // (vide en cas de conflit) — c'est le signal exactly-once du scheduler.
          return {
            returning: () =>
              Promise.resolve(existe ? [] : [{ id: valeurs['id'] }]),
          };
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (condition: unknown) => Promise.resolve(filtrer(condition)),
      }),
    }),
    update: () => ({
      set: (valeurs: Ligne) => ({
        where: (condition: unknown) => {
          for (const l of filtrer(condition)) {
            Object.assign(l, valeurs);
          }
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Database;
  return { db, lignes };
}

const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const SEMAINE = '2026-W27'; // 2026-06-29 … 2026-07-05 (à cheval juin/juillet)

const absence = (date: string) => ({
  date,
  debutHeures: 8,
  debutMinutes: 0,
  finHeures: 18,
  finMinutes: 0,
  preavisJours: 2,
  certificatMaladie: false,
});

/** Mock du client de relecture : saisie par mois (`null` = pas de saisie). */
function fakeClient(
  saisiesParMois: Record<string, Record<string, unknown> | null | undefined>,
): { client: PlanificationClient; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn((_contratId: string, mois: string) =>
    // `undefined` explicite (mois présent) = relecture dégradée ; mois absent = null.
    Promise.resolve(
      Object.prototype.hasOwnProperty.call(saisiesParMois, mois)
        ? saisiesParMois[mois]
        : null,
    ),
  );
  return {
    client: { lirePlanning: mock } as unknown as PlanificationClient,
    mock,
  };
}

describe('ValidationService.notifier', () => {
  it('insère une semaine A_VALIDER avec le snapshot des jours de la semaine', async () => {
    const { db, lignes } = fakeBase();
    const { client } = fakeClient({
      '2026-06': { absences: [absence('2026-06-29')] },
    });
    const service = new ValidationService(db, client);

    const cree = await service.notifier({
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
    });

    expect(cree).toBe(true);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      type: 'VALIDATION_HEBDO',
      statut: 'A_VALIDER',
    });
    expect(lignes[0]?.['snapshot']).toEqual({
      '2026-06-29': {
        joursSupplementaires: [],
        absences: [absence('2026-06-29')],
        exceptions: [],
        joursAlsh: [],
      },
    });
  });

  it('idempotent : un second tick ne crée pas de doublon et renvoie false', async () => {
    const { db, lignes } = fakeBase();
    const { client } = fakeClient({});
    const service = new ValidationService(db, client);

    const premier = await service.notifier({
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
    });
    const second = await service.notifier({
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
    });

    expect(premier).toBe(true);
    expect(second).toBe(false);
    expect(lignes).toHaveLength(1);
  });
});

describe('ValidationService.aValider', () => {
  it('ne liste que les semaines A_VALIDER du foyer, triées par semaine', async () => {
    const { db, lignes } = fakeBase();
    const { client } = fakeClient({});
    const service = new ValidationService(db, client);
    lignes.push(
      {
        ...DEFAUTS,
        id: 'a',
        contratId: CONTRAT_ID,
        foyerId: FOYER_ID,
        semaineIso: '2026-W28',
        type: 'VALIDATION_HEBDO',
        statut: 'A_VALIDER',
        snapshot: {},
      },
      {
        ...DEFAUTS,
        id: 'b',
        contratId: CONTRAT_ID,
        foyerId: FOYER_ID,
        semaineIso: '2026-W27',
        type: 'VALIDATION_HEBDO',
        statut: 'A_VALIDER',
        snapshot: {},
      },
      {
        ...DEFAUTS,
        id: 'c',
        contratId: CONTRAT_ID,
        foyerId: FOYER_ID,
        semaineIso: '2026-W26',
        type: 'VALIDATION_HEBDO',
        statut: 'VALIDEE',
        snapshot: {},
      },
      {
        ...DEFAUTS,
        id: 'd',
        contratId: CONTRAT_ID,
        foyerId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        semaineIso: '2026-W27',
        type: 'VALIDATION_HEBDO',
        statut: 'A_VALIDER',
        snapshot: {},
      },
    );

    const vues = await service.aValider(FOYER_ID);

    expect(vues.map((v) => v.semaineIso)).toEqual(['2026-W27', '2026-W28']);
    expect(vues.every((v) => v.statut === 'A_VALIDER')).toBe(true);
  });
});

describe('ValidationService.valider', () => {
  function seed(lignes: Ligne[], snapshot: unknown): void {
    lignes.push({
      ...DEFAUTS,
      id: 'n1',
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      type: 'VALIDATION_HEBDO',
      statut: 'A_VALIDER',
      snapshot,
    });
  }

  it('404 si la semaine n’a jamais été notifiée', async () => {
    const { db } = fakeBase();
    const { client } = fakeClient({});
    const service = new ValidationService(db, client);
    await expect(service.valider(CONTRAT_ID, SEMAINE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('relecture identique au snapshot ⇒ VALIDEE, sans delta', async () => {
    const { db, lignes } = fakeBase();
    const saisie = { absences: [absence('2026-06-29')] };
    seed(lignes, {
      '2026-06-29': {
        joursSupplementaires: [],
        absences: [absence('2026-06-29')],
        exceptions: [],
        joursAlsh: [],
      },
    });
    const { client } = fakeClient({ '2026-06': saisie });
    const service = new ValidationService(db, client);

    const res = await service.valider(CONTRAT_ID, SEMAINE);

    expect(res.statut).toBe('VALIDEE');
    expect(res.deltaModifs).toBeNull();
    expect(lignes[0]?.['statut']).toBe('VALIDEE');
    expect(lignes[0]?.['valideeLe']).toBeInstanceOf(Date);
  });

  it('relecture différente du snapshot ⇒ VALIDEE_AVEC_MODIFS + delta', async () => {
    const { db, lignes } = fakeBase();
    seed(lignes, {}); // snapshot vide au moment de la notif
    const { client } = fakeClient({
      '2026-07': { joursSupplementaires: [{ date: '2026-07-01' }] },
    });
    const service = new ValidationService(db, client);

    const res = await service.valider(CONTRAT_ID, SEMAINE);

    expect(res.statut).toBe('VALIDEE_AVEC_MODIFS');
    expect(res.deltaModifs?.jours.map((j) => j.date)).toEqual(['2026-07-01']);
    expect(lignes[0]?.['deltaModifs']).not.toBeNull();
  });

  it('idempotent : revalider renvoie l’état figé sans relire le planning', async () => {
    const { db, lignes } = fakeBase();
    seed(lignes, {});
    const { client, mock } = fakeClient({
      '2026-07': { joursSupplementaires: [{ date: '2026-07-01' }] },
    });
    const service = new ValidationService(db, client);

    const premier = await service.valider(CONTRAT_ID, SEMAINE);
    const appelsApresPremier = mock.mock.calls.length;
    const second = await service.valider(CONTRAT_ID, SEMAINE);

    expect(second).toEqual(premier);
    // La seconde validation ne relit pas le planning (statut déjà ≠ A_VALIDER).
    expect(mock.mock.calls.length).toBe(appelsApresPremier);
  });

  it('relecture indisponible (planif dégradée) ⇒ VALIDEE sans faux positif', async () => {
    const { db, lignes } = fakeBase();
    seed(lignes, {
      '2026-06-29': {
        joursSupplementaires: [],
        absences: [absence('2026-06-29')],
        exceptions: [],
        joursAlsh: [],
      },
    });
    const { client } = fakeClient({
      '2026-06': undefined,
      '2026-07': undefined,
    });
    const service = new ValidationService(db, client);

    const res = await service.valider(CONTRAT_ID, SEMAINE);

    expect(res.statut).toBe('VALIDEE');
    expect(res.deltaModifs).toBeNull();
  });
});
