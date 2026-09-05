import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '@creche-planner/nest-commons';
import { RepriseFermeturesService } from './reprise-fermetures.service.js';
import type { Database } from '../database/database.types.js';

/**
 * Tests unitaires de la **reprise de données du lot 4** — sans infra.
 *
 * Le faux `db` répond des lignes canned et **capture** ce qui est inséré : c'est
 * la capture qui prouve le scoping et l'idempotence, pas une relecture. Le SQL
 * réel (l'unicité partielle sur `(etablissement_id, jour)` encore ouverte) reste
 * couvert par la vérification pact provider, base réelle en CI.
 */

const CRECHE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CRECHE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAINTENANT = new Date('2026-09-05T08:00:00.000Z');
const horloge: Clock = { maintenant: () => MAINTENANT };

/** Les 18 dates que la reprise doit matérialiser, par établissement crèche. */
const NB_FERMETURES = 18;

interface FauxDb {
  readonly db: Database;
  readonly inserees: Record<string, unknown>[];
  readonly modes: unknown[];
}

/**
 * @param crecheries établissements rendus par le `selectDistinct` des contrats
 * @param dejaLa     couples (établissement, jour) portant déjà une exception ouverte
 */
function fakeDb(
  crecheries: string[],
  dejaLa: { etablissementId: string; jour: string }[] = [],
): FauxDb {
  const inserees: Record<string, unknown>[] = [];
  const modes: unknown[] = [];
  let appel = 0;
  const db = {
    selectDistinct: () => ({
      from: () => ({
        where: (condition: unknown) => {
          modes.push(condition);
          return Promise.resolve(
            crecheries.map((etablissementId) => ({ etablissementId })),
          );
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          appel += 1;
          return Promise.resolve(dejaLa);
        },
      }),
    }),
    insert: () => ({
      values: (lignes: Record<string, unknown>[]) => {
        inserees.push(...lignes);
        return Promise.resolve();
      },
    }),
    // Sonde de discipline : la reprise n'a aucune raison de supprimer quoi que
    // ce soit — le calendrier est append-only.
    delete: () => {
      throw new Error('la reprise ne doit jamais supprimer');
    },
    lecturesExceptions: () => appel,
  } as unknown as Database;
  return { db, inserees, modes };
}

describe('RepriseFermeturesService', () => {
  it('crée les 18 fermetures sur chaque établissement portant une crèche', async () => {
    const { db, inserees } = fakeDb([CRECHE_A, CRECHE_B]);
    const creees = await new RepriseFermeturesService(db, horloge).reprendre();

    expect(creees).toBe(NB_FERMETURES * 2);
    expect(inserees).toHaveLength(NB_FERMETURES * 2);
    expect(
      inserees.filter((l) => l['etablissementId'] === CRECHE_A),
    ).toHaveLength(NB_FERMETURES);
  });

  it('pose des exceptions FERMETURE totales, datées de maintenant', async () => {
    const { db, inserees } = fakeDb([CRECHE_A]);
    await new RepriseFermeturesService(db, horloge).reprendre();

    const ligne = inserees[0];
    expect(ligne?.['type']).toBe('FERMETURE');
    expect(ligne?.['libelle']).toBe('Fermeture crèche 2026');
    // `null` = tous les services : une fermeture crèche ferme la crèche.
    expect(ligne?.['services']).toBeNull();
    expect(ligne?.['connuDepuis']).toEqual(MAINTENANT);
  });

  it('reprend exactement les dates du Référentiel, fériés compris', async () => {
    const { db, inserees } = fakeDb([CRECHE_A]);
    await new RepriseFermeturesService(db, horloge).reprendre();

    const jours = inserees.map((l) => l['jour']);
    // Les trois familles du plan : le Nouvel An (férié), les fermetures de
    // janvier (non fériées) et la semaine de fin juillet.
    expect(jours).toContain('2026-01-01');
    expect(jours).toContain('2026-01-02');
    expect(jours).toContain('2026-07-31');
    expect(new Set(jours).size).toBe(NB_FERMETURES);
  });

  /**
   * **Le scoping, et pourquoi il ne se relâche pas.** Ces 18 dates sont les
   * fermetures d'une crèche réelle. Les poser sur tous les établissements —
   * écoles comprises, et crèches d'autres foyers sur un staging multi-foyers —
   * ferait entrer des données de référence dans des dossiers qui ne les ont
   * jamais connues, et fermerait des jours d'école qui sont ouverts.
   */
  it('ne touche aucun établissement sans contrat crèche', async () => {
    const { db, inserees } = fakeDb([]);
    const creees = await new RepriseFermeturesService(db, horloge).reprendre();

    expect(creees).toBe(0);
    expect(inserees).toHaveLength(0);
  });

  it('est idempotente : rien de recréé sur un couple déjà couvert', async () => {
    const dejaLa = [
      { etablissementId: CRECHE_A, jour: '2026-01-01' },
      { etablissementId: CRECHE_A, jour: '2026-07-31' },
    ];
    const { db, inserees } = fakeDb([CRECHE_A], dejaLa);
    const creees = await new RepriseFermeturesService(db, horloge).reprendre();

    expect(creees).toBe(NB_FERMETURES - 2);
    expect(inserees.map((l) => l['jour'])).not.toContain('2026-01-01');
    expect(inserees.map((l) => l['jour'])).not.toContain('2026-07-31');
  });

  it('n’insère rien du tout au second passage complet', async () => {
    const tout = [CRECHE_A].flatMap((etablissementId) =>
      [
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
        '2026-01-04',
        '2026-04-06',
        '2026-05-01',
        '2026-05-08',
        '2026-05-14',
        '2026-05-15',
        '2026-05-16',
        '2026-05-17',
        '2026-05-25',
        '2026-07-14',
        '2026-07-27',
        '2026-07-28',
        '2026-07-29',
        '2026-07-30',
        '2026-07-31',
      ].map((jour) => ({ etablissementId, jour })),
    );
    const { db, inserees } = fakeDb([CRECHE_A], tout);
    expect(await new RepriseFermeturesService(db, horloge).reprendre()).toBe(0);
    expect(inserees).toHaveLength(0);
  });

  /**
   * Le démarrage du service ne doit pas dépendre du succès de la reprise — mais
   * l'échec ne doit pas non plus disparaître. Un montant faux sans témoin est
   * exactement ce que ce lot existe pour empêcher.
   */
  it('journalise l’échec sans empêcher le démarrage', async () => {
    const db = {
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.reject(new Error('base indisponible')),
        }),
      }),
    } as unknown as Database;
    const service = new RepriseFermeturesService(db, horloge);
    const erreur = vi
      .spyOn(
        (service as unknown as { logger: { error: (m: string) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledWith(
      expect.stringContaining('base indisponible'),
    );
  });

  it('journalise le comptage exact attendu par le récapitulatif ops', async () => {
    const { db } = fakeDb([CRECHE_A]);
    const service = new RepriseFermeturesService(db, horloge);
    const log = vi
      .spyOn(
        (service as unknown as { logger: { log: (m: string) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);

    await service.onApplicationBootstrap();
    // Libellé attendu MOT POUR MOT par le récapitulatif ops du plan : le changer
    // casse la vérification de déploiement, pas seulement ce test.
    expect(log).toHaveBeenCalledWith(
      `exceptions crèche créées depuis jour_non_facturable : ${String(NB_FERMETURES)}`,
    );
  });
});
