import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { InboxService } from './inbox.service.js';
import type { Database } from '../database/database.types.js';
import type { NotificationRow } from '../database/schema.js';

/**
 * Tests unitaires de l'inbox in-app, sans Postgres. La base factice honore le
 * sous-ensemble utilisé par le service :
 * - `insert().values()` capture la ligne posée (journal append-only) ;
 * - `select().from().where().orderBy().limit()` (liste, `select()` sans projection)
 *   renvoie `rows`, tandis que `select({...}).from().where()` (compteur, `select` avec
 *   projection) renvoie les non-lus. Le prédicat `WHERE` (parent, `lu_le IS NULL`) n'est
 *   pas évalué — les tests fournissent directement le jeu attendu par parent ;
 * - `update().set().where().returning()` renvoie `updated` (vide ⇒ 404).
 *
 * On vérifie donc la **logique applicative** : mapping vers la vue (dates ISO 8601),
 * comptage des non-lus, valeurs insérées, et le 404 de `marquerLu` (id inconnu ou d'un
 * autre parent).
 */

const PARENT = '11111111-1111-4111-8111-111111111111';

function ligne(partiel: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parentId: PARENT,
    type: 'VALIDATION_HEBDO',
    sujet: 'Planning de la semaine du 29 juin au 5 juillet 2026 à valider',
    corps:
      'Le planning de Léa pour la semaine du 29 juin au 5 juillet 2026 est à valider.',
    lien: '/foyers/22222222-2222-4222-8222-222222222222/planning?semaine=2026-W27',
    creeLe: new Date('2026-06-23T06:01:00.000Z'),
    luLe: null,
    ...partiel,
  };
}

interface Options {
  readonly rows?: NotificationRow[];
  readonly nonLus?: NotificationRow[];
  readonly updated?: NotificationRow[];
}

function fakeBase(opts: Options = {}): {
  db: Database;
  inserted: Record<string, unknown>[];
} {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (valeurs: Record<string, unknown>) => {
        inserted.push(valeurs);
        return Promise.resolve();
      },
    }),
    // `select()` (sans projection) → liste ; `select({...})` → compteur non-lus.
    select: (projection?: unknown) => ({
      from: () => ({
        where: () => {
          if (projection === undefined) {
            const liste = opts.rows ?? [];
            const builder = {
              orderBy: () => builder,
              limit: () => Promise.resolve(liste),
            };
            return builder;
          }
          return Promise.resolve(opts.nonLus ?? []);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(opts.updated ?? []),
        }),
      }),
    }),
  } as unknown as Database;
  return { db, inserted };
}

describe('InboxService.creer', () => {
  it('archive une ligne avec un id généré, le parent, le type, le sujet, le corps et le lien', async () => {
    const { db, inserted } = fakeBase();
    const service = new InboxService(db);

    await service.creer({
      parentId: PARENT,
      type: 'VALIDATION_HEBDO',
      sujet: 'Sujet',
      corps: 'Corps',
      lien: '/foyers/f-1/planning?semaine=2026-W27',
    });

    expect(inserted).toHaveLength(1);
    const valeurs = inserted[0]!;
    expect(valeurs['parentId']).toBe(PARENT);
    expect(valeurs['type']).toBe('VALIDATION_HEBDO');
    expect(valeurs['sujet']).toBe('Sujet');
    expect(valeurs['corps']).toBe('Corps');
    expect(valeurs['lien']).toBe('/foyers/f-1/planning?semaine=2026-W27');
    expect(typeof valeurs['id']).toBe('string');
  });

  it('archive un lien nul (entrée sans navigation)', async () => {
    const { db, inserted } = fakeBase();
    const service = new InboxService(db);

    await service.creer({
      parentId: PARENT,
      type: 'VALIDATION_HEBDO',
      sujet: 'Sujet',
      corps: 'Corps',
      lien: null,
    });

    expect(inserted[0]!['lien']).toBeNull();
  });
});

describe('InboxService.lister', () => {
  it('renvoie les notifications (dates ISO) et le compteur de non-lus', async () => {
    const { db } = fakeBase({
      rows: [
        ligne({ id: 'n1', luLe: null }),
        ligne({
          id: 'n2',
          luLe: new Date('2026-06-24T10:00:00.000Z'),
        }),
      ],
      nonLus: [ligne({ id: 'n1' })], // une seule non-lue
    });
    const service = new InboxService(db);

    const vue = await service.lister(PARENT);

    expect(vue.notifications).toHaveLength(2);
    expect(vue.notifications[0]).toMatchObject({
      id: 'n1',
      type: 'VALIDATION_HEBDO',
      lien: '/foyers/22222222-2222-4222-8222-222222222222/planning?semaine=2026-W27',
      creeLe: '2026-06-23T06:01:00.000Z',
      luLe: null,
    });
    expect(vue.notifications[1]?.luLe).toBe('2026-06-24T10:00:00.000Z');
    expect(vue.nonLus).toBe(1);
  });

  it('inbox vide : liste vide et compteur à zéro', async () => {
    const { db } = fakeBase({ rows: [], nonLus: [] });
    const service = new InboxService(db);
    await expect(service.lister(PARENT)).resolves.toEqual({
      notifications: [],
      nonLus: 0,
    });
  });
});

describe('InboxService.marquerLu', () => {
  it('marque la notification lue et renvoie la vue mise à jour', async () => {
    const lu = new Date('2026-06-25T09:00:00.000Z');
    const { db } = fakeBase({ updated: [ligne({ id: 'n1', luLe: lu })] });
    const service = new InboxService(db);

    const vue = await service.marquerLu(PARENT, 'n1');

    expect(vue.id).toBe('n1');
    expect(vue.luLe).toBe('2026-06-25T09:00:00.000Z');
  });

  it('id inconnu ou d’un autre parent : 404 (aucune ligne mise à jour)', async () => {
    const { db } = fakeBase({ updated: [] });
    const service = new InboxService(db);
    await expect(service.marquerLu(PARENT, 'inconnu')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
