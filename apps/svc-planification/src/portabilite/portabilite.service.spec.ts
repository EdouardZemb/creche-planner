import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.types.js';
import { PortabiliteService } from './portabilite.service.js';

const FOYER_ID = '11111111-0000-4000-8000-000000000000';
const CONTRAT_ID = '22222222-0000-4000-8000-000000000000';

/**
 * Rend un prédicat en SQL paramétré par le **vrai** dialecte drizzle (motif des
 * specs de purge du lot 2b). Sans lui, un double de `db` prouve la projection des
 * colonnes mais jamais **sur quoi** la lecture filtre : une clé de rattachement
 * fausse rendrait les données d'un autre foyer avec exactement la même forme.
 */
const dialect = new PgDialect();

function rendre(cond: SQL | undefined): {
  sql: string;
  params: readonly unknown[];
} {
  if (!cond) {
    throw new Error('condition WHERE absente');
  }
  return dialect.sqlToQuery(cond);
}

/** Faux client de lecture : chaque select consomme la réponse suivante, dans l'ordre du code. */
function fakeDbLecture(...reponses: unknown[][]): {
  db: Database;
  nbSelect: () => number;
  conditions: (SQL | undefined)[];
} {
  let i = 0;
  const conditions: (SQL | undefined)[] = [];
  const select = vi.fn(() => {
    const lignes = reponses[i++] ?? [];
    const chaine: Record<string, unknown> = {};
    const maillon = () => Object.assign(Promise.resolve(lignes), chaine);
    chaine['where'] = vi.fn((cond: SQL | undefined) => {
      conditions.push(cond);
      return maillon();
    });
    chaine['orderBy'] = vi.fn(maillon);
    chaine['from'] = vi.fn(maillon);
    return chaine;
  });
  return {
    db: { select } as unknown as Database,
    nbSelect: () => select.mock.calls.length,
    conditions,
  };
}

const LE = new Date('2026-08-12T06:00:00.000Z');

function ligneContrat(): Record<string, unknown> {
  return {
    id: CONTRAT_ID,
    foyerId: FOYER_ID,
    enfant: 'Mia',
    enfantId: '33333333-0000-4000-8000-000000000000',
    mode: 'CRECHE_PSU',
    etablissementId: '44444444-0000-4000-8000-000000000000',
    valideDu: '2026-01-01',
    valideAu: null,
    premiereInscription: true,
    heuresAnnuellesContractualisees: 1600,
    nbMensualites: 12,
    semaineType: { lundi: [[480, 1020]] },
    semaineAbcm: null,
    createdAt: LE,
    updatedAt: LE,
  };
}

function ligneEtablissement(): Record<string, unknown> {
  return {
    id: '44444444-0000-4000-8000-000000000000',
    foyerId: FOYER_ID,
    nom: 'Crèche des Lilas',
    emailService: 'service@creche.test',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    types: ['CRECHE_PSU'],
    adresse: '3 rue des Lilas',
    telephone: '0388000000',
    contact: 'Mme Martin',
    actif: true,
    createdAt: LE,
    updatedAt: LE,
  };
}

describe('PortabiliteService (svc-planification)', () => {
  // L'écart le plus coûteux du lot côté planification : adresse, téléphone et
  // personne contact ne voyagent dans AUCUN événement d'intégration. Un export
  // bâti sur le read-model aval de svc-notifications les perdrait en silence.
  it('exporte les coordonnées de l’établissement, que la copie aval n’a pas', async () => {
    const { db } = fakeDbLecture(
      [ligneContrat()],
      [ligneEtablissement()],
      [],
      [],
      [],
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.etablissements[0]).toMatchObject({
      adresse: '3 rue des Lilas',
      telephone: '0388000000',
      contact: 'Mme Martin',
    });
  });

  // Ce que les autres tests ne prouvent PAS : sur quoi chaque lecture filtre.
  it('filtre contrats et établissements sur le foyer, les tables filles sur les contrats', async () => {
    const { db, conditions } = fakeDbLecture(
      [ligneContrat()],
      [ligneEtablissement()],
      [],
      [],
      [],
    );
    const service = new PortabiliteService(db);

    await service.exporter(FOYER_ID);

    const rendus = conditions.map(rendre);
    expect(rendus).toHaveLength(5);
    for (const rendu of rendus.slice(0, 2)) {
      expect(rendu.params).toEqual([FOYER_ID]);
      expect(rendu.sql).toContain('"foyer_id"');
    }
    // contrat_version, correction_journal et planning_mois n'ont PAS de
    // `foyer_id` : elles ne se rattachent au foyer que par leur contrat.
    for (const rendu of rendus.slice(2)) {
      expect(rendu.params).toEqual([CONTRAT_ID]);
      expect(rendu.sql).toContain('"contrat_id"');
      expect(rendu.sql).not.toContain('"foyer_id"');
    }
  });

  it('rattache avenants, corrections et plannings à leur contrat', async () => {
    const { db } = fakeDbLecture(
      [ligneContrat()],
      [],
      [
        {
          contratId: CONTRAT_ID,
          dateEffet: '2026-03-01',
          heuresAnnuellesContractualisees: 1700,
          nbMensualites: 12,
          semaineType: null,
          semaineAbcm: null,
          saisiLe: LE,
          motif: 'passage à 4 jours',
        },
      ],
      [
        {
          contratId: CONTRAT_ID,
          avant: { nbMensualites: 12 },
          apres: { nbMensualites: 11 },
          motif: null,
          corrigeLe: LE,
        },
      ],
      [
        {
          contratId: CONTRAT_ID,
          mois: '2026-03',
          simule: false,
          saisie: { absences: ['2026-03-04'] },
          updatedAt: LE,
        },
      ],
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    const contrat = vue.contrats[0];
    expect(contrat?.avenants).toHaveLength(1);
    expect(contrat?.avenants[0]?.motif).toBe('passage à 4 jours');
    expect(contrat?.corrections).toHaveLength(1);
    expect(contrat?.plannings[0]?.mois).toBe('2026-03');
  });

  // Les simulations sont des saisies du parent : les écarter reviendrait à
  // décider à sa place ce qui, dans ce qu'il a saisi, mérite de lui être rendu.
  it('inclut les plannings simulés', async () => {
    const { db } = fakeDbLecture(
      [ligneContrat()],
      [],
      [],
      [],
      [
        {
          contratId: CONTRAT_ID,
          mois: '2026-04',
          simule: true,
          saisie: {},
          updatedAt: LE,
        },
      ],
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.contrats[0]?.plannings[0]?.simule).toBe(true);
  });

  // `inArray(colonne, [])` produit un prédicat que Postgres refuse : sans cette
  // garde, un foyer sans contrat ferait échouer tout l'export.
  it('n’interroge pas les tables filles quand le foyer n’a aucun contrat', async () => {
    const { db, nbSelect } = fakeDbLecture([], []);
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.contrats).toEqual([]);
    // contrats + établissements = 2, et rien de plus.
    expect(nbSelect()).toBe(2);
  });
});
