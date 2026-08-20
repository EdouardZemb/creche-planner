import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Clock } from '@creche-planner/nest-commons';
import { CalendrierService } from './calendrier.service.js';
import type { Database } from '../database/database.types.js';
import {
  calendrierRecurrence,
  calendrierRegimeFeries,
  etablissement,
} from '../database/schema.js';

/**
 * Tests unitaires du `CalendrierService` **sans infra** (Postgres mocké). Le faux
 * `db` répond des lignes canned et **capture** ce qu'on lui demande d'écrire :
 * c'est cette capture qui prouve l'append-only, pas une relecture.
 *
 * Périmètre déclaré, pour que personne ne croie que cette suite prouve plus
 * qu'elle ne prouve : le SQL réel (unicités partielles, sémantique semi-ouverte
 * appliquée par Postgres, migration `0010`) est vérifié par la **vérification pact
 * provider**, base réelle en CI, dont l'état seedé porte une retouche de récurrence
 * précisément pour ça. Ici on prouve le **mappage** et la **discipline d'écriture**.
 */

const ETAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAINTENANT = new Date('2026-06-15T09:30:00.000Z');
const AVANT = '2026-02-01T00:00:00.000Z';

const horloge: Clock = { maintenant: () => MAINTENANT };

/** Une ligne de récurrence telle que Postgres la rend (dates en `Date`). */
function ligneRecurrence(
  services: string[],
  connuDepuis = '2026-01-01T00:00:00.000Z',
  connuJusqua: string | null = null,
): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    etablissementId: ETAB,
    regime: 'SCOLAIRE',
    jourSemaine: 'LUNDI',
    services,
    connuDepuis: new Date(connuDepuis),
    connuJusqua: connuJusqua === null ? null : new Date(connuJusqua),
  };
}

/**
 * Faux `db` pour les **lectures**, indexé **par table** et non par ordre d'appel.
 *
 * Ce n'est pas un détail de confort : `chargerCalendrier` lance ses quatre
 * requêtes dans un `Promise.all`, et les constructeurs de requête drizzle sont
 * *thenables* — la requête n'est consommée qu'au `await`, pas à sa construction.
 * L'ordre de consommation ne suit donc PAS l'ordre d'écriture, et un faux indexé
 * par rang produirait des tests qui passent ou cassent selon un détail
 * d'implémentation qu'ils ne testent pas. On répond par identité de table.
 *
 * La chaîne est terminale à `where`, `orderBy` ou `limit` — d'où le `then` posé
 * sur l'objet renvoyé, qui le rend « awaitable » à n'importe laquelle des trois.
 */
function fakeLecture(parTable: Map<unknown, unknown[]>): Database {
  const rendre = (table: unknown): Promise<unknown[]> =>
    Promise.resolve(parTable.get(table) ?? []);
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => rendre(table),
          limit: () => rendre(table),
          then: (resoudre: (v: unknown[]) => unknown) =>
            rendre(table).then(resoudre),
        }),
      }),
    }),
  } as unknown as Database;
}

/** L'établissement existe : la garde d'existence de chaque lecture est passée. */
function etabPresent(): Map<unknown, unknown[]> {
  return new Map<unknown, unknown[]>([[etablissement, [{ id: ETAB }]]]);
}

/**
 * Faux `db` transactionnel pour les **écritures**. Capte les `update().set()`
 * (les clôtures) et les `insert().values()` (les ouvertures), et **espionne
 * `delete`** : aucune écriture du calendrier ne doit jamais l'appeler.
 */
function fakeEcriture(lignesRendues: unknown[] = []): {
  db: Database;
  clotures: Record<string, unknown>[];
  ouvertures: unknown[];
  aSupprime: () => boolean;
} {
  const clotures: Record<string, unknown>[] = [];
  const ouvertures: unknown[] = [];
  let aSupprime = false;
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        clotures.push(s);
        return Object.assign(
          {
            where: () =>
              Object.assign(Promise.resolve(), {
                returning: () => Promise.resolve(lignesRendues),
              }),
          },
          {},
        );
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        ouvertures.push(v);
        return {
          returning: () =>
            Promise.resolve(
              lignesRendues.length > 0 ? lignesRendues : [ligneRecurrence([])],
            ),
        };
      },
    }),
    delete: () => {
      aSupprime = true;
      return { where: () => Promise.resolve() };
    },
  };
  const db = {
    ...tx,
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    // La garde d'existence (`garantirEtablissement`) passe par le `db`, pas par
    // la transaction : elle doit trouver l'établissement. La `select` du `tx`,
    // elle, sert `poserRegimeFeries` et rend une tranche vide — donc « aucun
    // régime en vigueur », le cas où la pose doit écrire.
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: ETAB }]),
          // `remplacerRecurrences` relit la couche après écriture : la relecture
          // rend les lignes qu'on lui a dit de rendre, pas la garde d'existence.
          orderBy: () => Promise.resolve(lignesRendues),
        }),
      }),
    }),
  } as unknown as Database;
  return { db, clotures, ouvertures, aSupprime: () => aSupprime };
}

describe('CalendrierService.lireResolu — les deux axes de temps', () => {
  it('refuse une plage inversée avant d’aller en base', async () => {
    const service = new CalendrierService(fakeLecture(new Map()), horloge);
    await expect(
      service.lireResolu(ETAB, '2026-03-10', '2026-03-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une plage de plus de 366 jours (borne, pas balayage)', async () => {
    const service = new CalendrierService(fakeLecture(new Map()), horloge);
    await expect(
      service.lireResolu(ETAB, '2026-01-01', '2027-01-02'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepte exactement 366 jours (la borne est inclusive)', async () => {
    const service = new CalendrierService(fakeLecture(etabPresent()), horloge);
    const vue = await service.lireResolu(ETAB, '2026-01-01', '2027-01-01');
    expect(vue.jours).toHaveLength(366);
  });

  it('rend 404 quand l’établissement n’existe pas', async () => {
    const service = new CalendrierService(fakeLecture(new Map()), horloge);
    await expect(
      service.lireResolu(ETAB, '2026-03-02', '2026-03-02'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('réverbère l’instant employé — et prend « maintenant » quand il est omis', async () => {
    const service = new CalendrierService(fakeLecture(etabPresent()), horloge);
    const vue = await service.lireResolu(ETAB, '2026-03-02', '2026-03-02');
    // Le défaut du contrat gelé n'est pas implicite : il se lit dans la réponse.
    expect(vue.aLaDate).toBe(MAINTENANT.toISOString());
    expect(vue).toMatchObject({ du: '2026-03-02', au: '2026-03-02' });
  });

  it('réverbère l’instant fourni tel quel', async () => {
    const service = new CalendrierService(fakeLecture(etabPresent()), horloge);
    const vue = await service.lireResolu(
      ETAB,
      '2026-03-02',
      '2026-03-02',
      AVANT,
    );
    expect(vue.aLaDate).toBe(AVANT);
  });

  it('mappe les lignes vers le domaine et rend les services de la récurrence', async () => {
    const service = new CalendrierService(
      fakeLecture(
        new Map<unknown, unknown[]>([
          [etablissement, [{ id: ETAB }]],
          [
            calendrierRecurrence,
            [ligneRecurrence(['CANTINE', 'PERISCOLAIRE'])],
          ],
          [calendrierRegimeFeries, [{ regime: 'FR' }]],
        ]),
      ),
      horloge,
    );
    // 2026-03-02 est un lundi, et mars 2026 ne porte aucun férié français : le
    // jour ne dépend donc que de la récurrence — c'est le mappage qu'on teste,
    // pas le calcul des fériés (couvert dans le `shared-kernel`).
    const vue = await service.lireResolu(ETAB, '2026-03-02', '2026-03-02');
    expect(vue.jours[0]).toEqual({
      jour: '2026-03-02',
      contexte: 'PERIODE_SCOLAIRE',
      libelle: '',
      servicesOuverts: ['CANTINE', 'PERISCOLAIRE'],
    });
  });

  it('ne voit pas une ligne close avant l’instant demandé', async () => {
    const service = new CalendrierService(
      fakeLecture(
        new Map<unknown, unknown[]>([
          [etablissement, [{ id: ETAB }]],
          // Close au 1er mars : à la lecture du 15 juin, elle ne s'applique plus.
          [
            calendrierRecurrence,
            [
              ligneRecurrence(
                ['CANTINE'],
                '2026-01-01T00:00:00.000Z',
                '2026-03-01T00:00:00.000Z',
              ),
            ],
          ],
          [calendrierRegimeFeries, [{ regime: 'FR' }]],
        ]),
      ),
      horloge,
    );
    const vue = await service.lireResolu(ETAB, '2026-03-02', '2026-03-02');
    // Sans récurrence applicable, l'établissement est réputé ouvert à tout (D7).
    expect(vue.jours[0]?.servicesOuverts).toEqual([
      'CRECHE_PSU',
      'PERISCOLAIRE',
      'CANTINE',
      'ALSH',
    ]);
  });

  it('retombe sur le régime FR quand aucune ligne de régime n’est connue (D7)', async () => {
    const service = new CalendrierService(fakeLecture(etabPresent()), horloge);
    // Vendredi saint 2026 : férié en Alsace-Moselle, ouvré au régime national.
    const vue = await service.lireResolu(ETAB, '2026-04-03', '2026-04-03');
    expect(vue.jours[0]?.contexte).not.toBe('FERIE');
  });
});

describe('CalendrierService — l’écriture est append-only', () => {
  it('clôt la récurrence en vigueur AVANT d’ouvrir la nouvelle, au même instant', async () => {
    // La relecture d'après écriture rend une ligne de récurrence complète : ce
    // qu'on teste ici est la SÉQUENCE d'écriture, pas la relecture.
    const { db, clotures, ouvertures } = fakeEcriture([
      ligneRecurrence(['CANTINE']),
    ]);
    const service = new CalendrierService(db, horloge);
    await service.remplacerRecurrences(ETAB, {
      recurrences: [
        { regime: 'SCOLAIRE', jourSemaine: 'LUNDI', services: ['CANTINE'] },
      ],
    });
    expect(clotures).toHaveLength(1);
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    const ouvertes = ouvertures[0] as { connuDepuis: Date }[];
    // Même instant des deux côtés : sans cela il existerait un intervalle, si
    // bref soit-il, où la couche n'a aucune ligne ouverte.
    expect(ouvertes[0]?.connuDepuis).toEqual(MAINTENANT);
  });

  it('n’ouvre rien quand la semaine type est vidée (mais clôt quand même)', async () => {
    const { db, clotures, ouvertures } = fakeEcriture([]);
    const service = new CalendrierService(db, horloge);
    await service.remplacerRecurrences(ETAB, { recurrences: [] });
    expect(clotures).toHaveLength(1);
    expect(ouvertures).toHaveLength(0);
  });

  it('« supprimer » une exception la CLÔT (aucun delete)', async () => {
    const { db, clotures, aSupprime } = fakeEcriture([{ id: 'x' }]);
    const service = new CalendrierService(db, horloge);
    await service.cloreException(ETAB, '22222222-2222-4222-8222-222222222222');
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    expect(aSupprime()).toBe(false);
  });

  it('« supprimer » une période la CLÔT (aucun delete)', async () => {
    const { db, clotures, aSupprime } = fakeEcriture([{ id: 'x' }]);
    const service = new CalendrierService(db, horloge);
    await service.clorePeriode(ETAB, '22222222-2222-4222-8222-222222222222');
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    expect(aSupprime()).toBe(false);
  });

  it('rend 404 sur la clôture d’une ligne inconnue ou déjà close', async () => {
    const { db } = fakeEcriture([]);
    const service = new CalendrierService(db, horloge);
    await expect(
      service.clorePeriode(ETAB, '22222222-2222-4222-8222-222222222222'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.cloreException(ETAB, '22222222-2222-4222-8222-222222222222'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la retouche d’une période clôt puis rouvre, et la repasse en MANUEL', async () => {
    const { db, clotures, ouvertures } = fakeEcriture([
      {
        id: 'p',
        etablissementId: ETAB,
        type: 'VACANCES',
        libelle: 'Printemps',
        du: '2026-04-04',
        au: '2026-04-20',
        source: 'IMPORT',
        anneeScolaire: null,
        connuDepuis: MAINTENANT,
        connuJusqua: null,
      },
    ]);
    const service = new CalendrierService(db, horloge);
    await service.retoucherPeriode(
      ETAB,
      '33333333-3333-4333-8333-333333333333',
      {
        type: 'VACANCES',
        libelle: 'Printemps (corrigé)',
        du: '2026-04-04',
        au: '2026-04-19',
      },
    );
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    // Une période importée puis retouchée devient une saisie du parent : c'est
    // ce qui la protège du prochain réimport (CA2, lot 3).
    expect(ouvertures[0]).toMatchObject({ source: 'MANUEL' });
  });

  it('poser une exception clôt celle du même jour avant d’insérer', async () => {
    const { db, clotures, ouvertures } = fakeEcriture([
      {
        id: 'e',
        etablissementId: ETAB,
        jour: '2026-03-03',
        type: 'FERMETURE',
        libelle: 'Fermeture',
        services: null,
        connuDepuis: MAINTENANT,
        connuJusqua: null,
      },
    ]);
    const service = new CalendrierService(db, horloge);
    const vue = await service.poserException(ETAB, {
      jour: '2026-03-03',
      type: 'FERMETURE',
      libelle: 'Fermeture',
    });
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    // `services` omis ⇒ `null` en base, qui veut dire « tous les services » —
    // à ne surtout pas écrire `[]`, qui veut dire « aucun ».
    expect(ouvertures[0]).toMatchObject({ services: null });
    expect(vue.services).toBeNull();
  });

  it('poser une exception ciblée écrit la liste, pas null', async () => {
    const { db, ouvertures } = fakeEcriture([
      {
        id: 'e',
        etablissementId: ETAB,
        jour: '2026-03-03',
        type: 'OUVERTURE',
        libelle: 'Garderie',
        services: ['ALSH'],
        connuDepuis: MAINTENANT,
        connuJusqua: null,
      },
    ]);
    const service = new CalendrierService(db, horloge);
    await service.poserException(ETAB, {
      jour: '2026-03-03',
      type: 'OUVERTURE',
      libelle: 'Garderie',
      services: ['ALSH'],
    });
    expect(ouvertures[0]).toMatchObject({ services: ['ALSH'] });
  });
});

describe('CalendrierService — un conflit de concurrence est un 409, pas un 500', () => {
  /** Faux `db` dont l'écriture heurte l'unicité partielle (`23505` de `postgres`). */
  function fakeConflit(): Database {
    const erreur = Object.assign(new Error('duplicate key'), { code: '23505' });
    return {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: ETAB }]) }),
        }),
      }),
      transaction: () => Promise.reject(erreur),
    } as unknown as Database;
  }

  it('traduit un 23505 en 409 sur la pose d’exception', async () => {
    const service = new CalendrierService(fakeConflit(), horloge);
    await expect(
      service.poserException(ETAB, {
        jour: '2026-03-03',
        type: 'FERMETURE',
        libelle: 'Fermeture',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('traduit un 23505 en 409 sur le remplacement de la semaine type', async () => {
    const service = new CalendrierService(fakeConflit(), horloge);
    await expect(
      service.remplacerRecurrences(ETAB, { recurrences: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('laisse passer une erreur qui n’est pas une violation d’unicité', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: ETAB }]) }),
        }),
      }),
      transaction: () => Promise.reject(new Error('connexion perdue')),
    } as unknown as Database;
    const service = new CalendrierService(db, horloge);
    await expect(
      service.remplacerRecurrences(ETAB, { recurrences: [] }),
    ).rejects.toThrow('connexion perdue');
  });
});

describe('CalendrierService.poserRegimeFeries — l’axe de connaissance du régime (AM-106)', () => {
  it('clôt la tranche en cours puis en ouvre une nouvelle', async () => {
    const { db, clotures, ouvertures } = fakeEcriture([]);
    const service = new CalendrierService(db, horloge);
    await service.poserRegimeFeries(
      db as unknown as Parameters<typeof service.poserRegimeFeries>[0],
      ETAB,
      'FR_ALSACE_MOSELLE',
    );
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    expect(ouvertures[0]).toMatchObject({
      regime: 'FR_ALSACE_MOSELLE',
      connuDepuis: MAINTENANT,
    });
  });

  it('reposer le régime déjà en vigueur est un no-op (pas d’historique haché)', async () => {
    const { clotures, ouvertures } = fakeEcriture([]);
    // `tx.select()` rend la tranche ouverte : même régime que celui qu'on pose.
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ regime: 'FR' }]) }),
        }),
      }),
      update: () => ({
        set: (s: Record<string, unknown>) => {
          clotures.push(s);
          return { where: () => Promise.resolve() };
        },
      }),
      insert: () => ({
        values: (v: unknown) => {
          ouvertures.push(v);
          return Promise.resolve();
        },
      }),
    };
    const service = new CalendrierService({} as unknown as Database, horloge);
    await service.poserRegimeFeries(
      tx as unknown as Parameters<typeof service.poserRegimeFeries>[0],
      ETAB,
      'FR',
    );
    expect(clotures).toHaveLength(0);
    expect(ouvertures).toHaveLength(0);
  });

  it('rend une table vide sans interroger la base pour zéro établissement', async () => {
    const service = new CalendrierService(fakeLecture(new Map()), horloge);
    await expect(service.regimesFeriesOuverts([])).resolves.toEqual(new Map());
  });

  it('indexe les régimes ouverts par établissement', async () => {
    const service = new CalendrierService(
      fakeLecture(
        new Map<unknown, unknown[]>([
          [
            calendrierRegimeFeries,
            [{ etablissementId: ETAB, regime: 'FR_ALSACE_MOSELLE' }],
          ],
        ]),
      ),
      horloge,
    );
    const table = await service.regimesFeriesOuverts([ETAB]);
    expect(table.get(ETAB)).toBe('FR_ALSACE_MOSELLE');
  });
});

/**
 * **Sonde négative de l'append-only**, au niveau de la source. Les tests ci-dessus
 * prouvent que les chemins qu'ils empruntent ne suppriment rien ; celui-ci prouve
 * qu'**aucun** chemin ne le fait, y compris ceux qu'aucun test n'emprunte encore.
 * C'est la différence entre « les cas testés ne suppriment pas » et « le service
 * ne sait pas supprimer » — et c'est la seconde propriété que RM-31-03 exige.
 *
 * Si un `db.delete(` légitime devait apparaître un jour (une purge de rétention,
 * par exemple), ce test rougirait et forcerait à l'écrire ici plutôt qu'à le
 * laisser passer.
 */
describe('CalendrierService — sonde négative : aucune suppression en source', () => {
  it('n’appelle `delete` nulle part dans le service', () => {
    // `import.meta` est interdit ici (sortie CommonJS) : on part du cwd de
    // vitest, qui est la racine du projet Nx (`apps/svc-planification`).
    const source = readFileSync(
      join(process.cwd(), 'src/calendrier/calendrier.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\.delete\(/);
  });

  it('voit bien ce qu’elle cherche (la sonde de la sonde)', () => {
    // Sans ce contrôle, une regex qui ne matche jamais rendrait le test ci-dessus
    // vert pour la mauvaise raison — le mode de défaillance dominant du dépôt.
    expect('await tx.delete(calendrierPeriode)').toMatch(/\.delete\(/);
  });

  /**
   * **Sonde négative n°2, née d'un défaut réel.** Un fragment `sql` brut qui
   * interpole une valeur la passe en paramètre **sans le type de la colonne** :
   * `postgres` reçoit un `Date` qu'il ne sait pas encoder, et la route meurt en
   * 500. Le typecheck ne le voit pas, et les tests ci-dessus non plus — un faux
   * `db` n'exécute aucune requête. Seule la vérification pact provider, contre une
   * vraie base, l'a montré (`LE-88`).
   *
   * Ce test est le filet qui manquait : il refuse **toute** interpolation de
   * valeur dans un `sql\`…\`` de ce service. Les comparateurs typés de drizzle
   * (`lte`, `gt`, `eq`…) couvrent tout ce dont le calendrier a besoin.
   */
  it('n’interpole aucune valeur dans un fragment `sql` brut', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/calendrier/calendrier.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/sql`/);
  });

  it('voit bien un fragment `sql` quand il y en a un (sonde de la sonde)', () => {
    expect('or(isNull(c), sql`${c} > ${borne}`)').toMatch(/sql`/);
  });
});
