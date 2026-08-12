import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.types.js';
import { PortabiliteService } from './portabilite.service.js';

const FOYER_ID = '11111111-0000-4000-8000-000000000000';
const PARENT_ID = '22222222-0000-4000-8000-000000000000';

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

/**
 * Les 6 réponses attendues, dans l'ordre : validations, récaps foyer, récaps
 * parent, envois établissement, `foyer_parent`, puis la boîte de réception.
 */
function reponses(
  parents: Record<string, unknown>[],
  messages: Record<string, unknown>[] = [],
  envoisEtab: Record<string, unknown>[] = [],
): unknown[][] {
  return [[], [], [], envoisEtab, parents, messages];
}

describe('PortabiliteService (svc-notifications)', () => {
  // `notification` est clée par `parent_id`, sans `foyer_id` : les parents se
  // résolvent localement par `foyer_parent`, exactement comme le fait
  // l'effacement du lot 2a.
  it('résout les parents par `foyer_parent` pour sortir la boîte de réception', async () => {
    const { db } = fakeDbLecture(
      ...reponses(
        [{ parentId: PARENT_ID }],
        [
          {
            parentId: PARENT_ID,
            type: 'VALIDATION_HEBDO',
            sujet: 'Votre semaine',
            corps: 'Bonjour…',
            lien: `/foyers/${FOYER_ID}/planning?semaine=2026-W33`,
            creeLe: LE,
            luLe: null,
          },
        ],
      ),
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.messagesInApp).toHaveLength(1);
    expect(vue.messagesInApp[0]).toMatchObject({
      parentId: PARENT_ID,
      sujet: 'Votre semaine',
      luLe: null,
    });
  });

  // Ce que les autres tests ne prouvent PAS : sur quoi chaque lecture filtre.
  it('filtre les 4 tables du foyer sur le foyer, et la boîte de réception sur les parents', async () => {
    const { db, conditions } = fakeDbLecture(
      ...reponses([{ parentId: PARENT_ID }], [], []),
    );
    const service = new PortabiliteService(db);

    await service.exporter(FOYER_ID);

    const rendus = conditions.map(rendre);
    expect(rendus).toHaveLength(6);
    // notification_hebdo, envoi_recap_hebdo, envoi_recap_parent,
    // envoi_etablissement, puis foyer_parent (la table de résolution).
    for (const rendu of rendus.slice(0, 5)) {
      expect(rendu.params).toEqual([FOYER_ID]);
      expect(rendu.sql).toContain('"foyer_id"');
    }
    // `notification` n'a PAS de `foyer_id` : elle se rattache par `parent_id`.
    expect(rendus[5]?.params).toEqual([PARENT_ID]);
    expect(rendus[5]?.sql).toContain('"parent_id"');
    expect(rendus[5]?.sql).not.toContain('"foyer_id"');
  });

  // Le corps figé est la seule donnée que le parent ne retrouve nulle part
  // ailleurs : c'est la preuve de ce qui est réellement parti en son nom.
  it('exporte le corps figé de l’envoi à l’établissement', async () => {
    const { db } = fakeDbLecture(
      ...reponses(
        [],
        [],
        [
          {
            foyerId: FOYER_ID,
            semaineIso: '2026-W33',
            etablissementId: '44444444-0000-4000-8000-000000000000',
            destinataire: 'service@creche.test',
            sujet: 'Semaine du 10 août',
            corps: '<p>Mia : lundi, mardi</p>',
            statut: 'ENVOYE',
            messageId: '<abc@smtp>',
            erreur: null,
            envoyeLe: LE,
            createdAt: LE,
          },
        ],
      ),
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.envoisEtablissement[0]).toMatchObject({
      destinataire: 'service@creche.test',
      corps: '<p>Mia : lundi, mardi</p>',
      statut: 'ENVOYE',
    });
  });

  // Toutes les dates de ce service sont nullables et signifient quelque chose
  // par leur absence : « pas encore validée », « jamais envoyé ». Elles doivent
  // sortir en `null` explicite, pas disparaître du document.
  it('rend les sections datées, `null` compris quand la date n’est pas posée', async () => {
    const { db } = fakeDbLecture(
      [
        {
          semaineIso: '2026-W33',
          contratId: '55555555-0000-4000-8000-000000000000',
          type: 'VALIDATION_HEBDO',
          statut: 'A_VALIDER',
          notifieeLe: LE,
          valideeLe: null,
          snapshot: { jours: [] },
          deltaModifs: null,
        },
      ],
      [
        {
          semaineIso: '2026-W33',
          statut: 'ENVOYE',
          destinataires: ['alex@example.test'],
          erreur: null,
          envoyeLe: LE,
          creeLe: LE,
        },
      ],
      [
        {
          semaineIso: '2026-W33',
          parentId: PARENT_ID,
          email: 'alex@example.test',
          statut: 'ECHEC',
          essais: 3,
          erreur: 'SMTP 550',
          envoyeLe: null,
        },
      ],
      [],
      [],
      [],
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.validationsHebdo[0]).toMatchObject({
      statut: 'A_VALIDER',
      valideeLe: null,
      deltaModifs: null,
      notifieeLe: LE.toISOString(),
    });
    expect(vue.envoisRecapFoyer[0]).toMatchObject({
      destinataires: ['alex@example.test'],
      envoyeLe: LE.toISOString(),
    });
    expect(vue.envoisRecapParent[0]).toMatchObject({
      statut: 'ECHEC',
      essais: 3,
      erreur: 'SMTP 550',
      envoyeLe: null,
    });
  });

  // `inArray(colonne, [])` produit un prédicat que Postgres refuse : sans cette
  // garde, un foyer dont aucun parent n'est encore projeté ferait échouer l'export.
  it('n’interroge pas la boîte de réception quand aucun parent n’est projeté', async () => {
    const { db, nbSelect } = fakeDbLecture(...reponses([]));
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.messagesInApp).toEqual([]);
    // 4 tables du foyer + `foyer_parent` = 5, et rien de plus.
    expect(nbSelect()).toBe(5);
  });
});
