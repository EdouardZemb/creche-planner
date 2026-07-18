import { describe, expect, it } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import { SuiviEnvoisService } from './suivi-envois.service.js';
import type { Database } from '../database/database.types.js';
import {
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
} from '../database/schema.js';

/**
 * Tests du service de **suivi des envois** (B1) sans Postgres : base factice qui honore
 * le seul appel utilisé — `select().from(table).where(and(eq…))`. Le service est en
 * **lecture seule** : on vérifie le mapping (statuts, ISO, `essais`), l'ordre déterministe
 * (e-mail / id d'établissement), le cas vide (rappel null + établissements vides) et le
 * rappel sans ligne parent.
 */
type Ligne = Record<string, unknown>;

/** Nom de propriété TS d'une colonne dans sa table (ex. `foyer_id` → `foyerId`). */
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

function fakeBase(stores: Map<Table, Ligne[]>): Database {
  const filtrer = (table: Table, condition: unknown): Ligne[] => {
    const paires = pairesEq(condition, table);
    return (stores.get(table) ?? []).filter((l) =>
      paires.every((p) => l[p.cle] === p.valeur),
    );
  };
  return {
    select: () => ({
      from: (table: Table) => ({
        where: (condition: unknown) =>
          Promise.resolve(filtrer(table, condition)),
      }),
    }),
  } as unknown as Database;
}

const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const SEMAINE = '2026-W27';
const ETAB_A = '99999999-9999-4999-8999-99999999000a';
const ETAB_B = '99999999-9999-4999-8999-99999999000b';
const PARENT_1 = '77777777-7777-4777-8777-777777777001';
const PARENT_2 = '77777777-7777-4777-8777-777777777002';

function stores(): Map<Table, Ligne[]> {
  return new Map<Table, Ligne[]>([
    [envoiRecapHebdo, []],
    [envoiRecapParent, []],
    [envoiEtablissement, []],
  ]);
}

describe('SuiviEnvoisService.lire', () => {
  it('agrège le rappel (parents triés) et les établissements (triés par id)', async () => {
    const s = stores();
    s.get(envoiRecapHebdo)?.push({
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      statut: 'ENVOYE',
      destinataires: ['a@ex.org', 'b@ex.org'],
      messageId: '<recap@test>',
      erreur: null,
      envoyeLe: new Date('2026-06-23T06:00:00.000Z'),
      creeLe: new Date('2026-06-23T05:00:00.000Z'),
      majLe: new Date('2026-06-23T06:00:00.000Z'),
    });
    // Insérés dans le désordre → doivent ressortir triés par e-mail.
    s.get(envoiRecapParent)?.push({
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      parentId: PARENT_2,
      statut: 'ECHEC',
      email: 'zoe@ex.org',
      essais: 3,
      messageId: null,
      erreur: 'SMTP 550',
      envoyeLe: null,
      creeLe: new Date(),
      majLe: new Date(),
    });
    s.get(envoiRecapParent)?.push({
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      parentId: PARENT_1,
      statut: 'ENVOYE',
      email: 'ada@ex.org',
      essais: 0,
      messageId: '<p1@test>',
      erreur: null,
      envoyeLe: new Date('2026-06-23T06:00:00.000Z'),
      creeLe: new Date(),
      majLe: new Date(),
    });
    // Deux établissements insérés dans le désordre → triés par id.
    s.get(envoiEtablissement)?.push({
      id: 'e-b',
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      etablissementId: ETAB_B,
      destinataire: 'b-creche@ex.org',
      sujet: 'Sujet',
      corps: '<p>b</p>',
      statut: 'ECHEC',
      messageId: null,
      erreur: 'transport indisponible',
      envoyeLe: null,
      createdAt: new Date(),
    });
    s.get(envoiEtablissement)?.push({
      id: 'e-a',
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      etablissementId: ETAB_A,
      destinataire: 'a-creche@ex.org',
      sujet: 'Sujet',
      corps: '<p>a</p>',
      statut: 'DRY_RUN',
      messageId: null,
      erreur: null,
      envoyeLe: new Date('2026-06-23T06:05:00.000Z'),
      createdAt: new Date(),
    });

    const vue = await new SuiviEnvoisService(fakeBase(s)).lire(
      FOYER_ID,
      SEMAINE,
    );

    expect(vue.foyerId).toBe(FOYER_ID);
    expect(vue.semaineIso).toBe(SEMAINE);
    expect(vue.rappel).not.toBeNull();
    expect(vue.rappel?.statut).toBe('ENVOYE');
    expect(vue.rappel?.envoyeLe).toBe('2026-06-23T06:00:00.000Z');
    // Parents triés par e-mail : ada avant zoe.
    expect(vue.rappel?.parents.map((p) => p.email)).toEqual([
      'ada@ex.org',
      'zoe@ex.org',
    ]);
    expect(vue.rappel?.parents[0]?.statut).toBe('ENVOYE');
    expect(vue.rappel?.parents[0]?.essais).toBe(0);
    expect(vue.rappel?.parents[1]?.statut).toBe('ECHEC');
    expect(vue.rappel?.parents[1]?.essais).toBe(3);
    expect(vue.rappel?.parents[1]?.envoyeLe).toBeNull();
    // Établissements triés par id (ETAB_A ...000a avant ETAB_B ...000b).
    expect(vue.etablissements.map((e) => e.etablissementId)).toEqual([
      ETAB_A,
      ETAB_B,
    ]);
    expect(vue.etablissements[0]?.statut).toBe('DRY_RUN');
    expect(vue.etablissements[0]?.destinataire).toBe('a-creche@ex.org');
    expect(vue.etablissements[0]?.envoyeLe).toBe('2026-06-23T06:05:00.000Z');
    expect(vue.etablissements[1]?.statut).toBe('ECHEC');
    expect(vue.etablissements[1]?.erreur).toBe('transport indisponible');
    expect(vue.etablissements[1]?.envoyeLe).toBeNull();
  });

  it('cas vide : aucune donnée → rappel null et établissements vides', async () => {
    const vue = await new SuiviEnvoisService(fakeBase(stores())).lire(
      FOYER_ID,
      SEMAINE,
    );
    expect(vue.rappel).toBeNull();
    expect(vue.etablissements).toEqual([]);
  });

  it('rappel sans ligne parent : parents vides (slot A_ENVOYER de début de semaine)', async () => {
    const s = stores();
    s.get(envoiRecapHebdo)?.push({
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      statut: 'A_ENVOYER',
      destinataires: [],
      messageId: null,
      erreur: null,
      envoyeLe: null,
      creeLe: new Date(),
      majLe: new Date(),
    });

    const vue = await new SuiviEnvoisService(fakeBase(s)).lire(
      FOYER_ID,
      SEMAINE,
    );

    expect(vue.rappel?.statut).toBe('A_ENVOYER');
    expect(vue.rappel?.envoyeLe).toBeNull();
    expect(vue.rappel?.parents).toEqual([]);
    expect(vue.etablissements).toEqual([]);
  });
});
