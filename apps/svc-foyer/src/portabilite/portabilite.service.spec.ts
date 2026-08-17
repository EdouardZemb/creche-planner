import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.types.js';
import { PortabiliteService } from './portabilite.service.js';

/**
 * Rend un prédicat en SQL paramétré par le **vrai** dialecte drizzle (motif de
 * `purge/taches-purge.spec.ts`). Sans lui, un double de `db` prouve la projection
 * des colonnes mais jamais **sur quoi** la lecture filtre : une clé de
 * rattachement fausse (`enfant.id` au lieu de `enfant.foyer_id`) passerait tous
 * les autres tests de ce fichier.
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

const FOYER_ID = '11111111-0000-4000-8000-000000000000';
const PARENT_ID = '22222222-0000-4000-8000-000000000000';
const PARENT_RETIRE_ID = '33333333-0000-4000-8000-000000000000';

/**
 * Faux `db` de lecture : chaque `select()` consomme la réponse suivante, dans
 * l'ordre où le service les demande. `Promise.all` n'introduit aucune
 * indétermination ici — les appels `select()` sont émis à la construction du
 * tableau, donc dans l'ordre du code (motif de `foyer.service.spec.ts`).
 */
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

function ligneFoyer(): Record<string, unknown> {
  return {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 350000,
    rfrCentimes: 7270500,
    nbEnfantsACharge: 2,
    nbParts: 3,
    createdAt: LE,
    updatedAt: LE,
  };
}

function ligneParent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PARENT_ID,
    foyerId: FOYER_ID,
    prenom: 'Alex',
    nom: 'Dupont',
    email: 'alex@example.test',
    principal: true,
    ordre: 0,
    actif: true,
    createdAt: LE,
    updatedAt: LE,
    ...overrides,
  };
}

/**
 * Les 8 réponses attendues, **dans l'ordre des `select()`** : foyer, versions,
 * corrections, enfants, parents, piste d'audit, puis les deux tables filles
 * (préférences, jetons), lues après les parents dont elles dépendent.
 */
function reponses(
  parents: Record<string, unknown>[],
  preferences: Record<string, unknown>[] = [],
  jetons: Record<string, unknown>[] = [],
  audit: Record<string, unknown>[] = [],
): unknown[][] {
  return [[ligneFoyer()], [], [], [], parents, audit, preferences, jetons];
}

describe('PortabiliteService (svc-foyer)', () => {
  it('lève 404 si le foyer n’existe pas — un export ne fabrique pas de dossier vide', async () => {
    const { db } = fakeDbLecture([]);
    const service = new PortabiliteService(db);

    await expect(service.exporter(FOYER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Ce que les autres tests de ce fichier ne prouvent PAS : sur quoi chaque
  // lecture filtre. Une clé de rattachement fausse rendrait les données d'un
  // AUTRE foyer avec exactement la même forme, et tous les autres tests
  // passeraient. On rend donc le prédicat en SQL par le vrai dialecte.
  it('filtre les 6 tables du foyer sur le foyer, et les 2 tables filles sur ses parents', async () => {
    const { db, conditions } = fakeDbLecture(
      ...reponses([ligneParent()], [], []),
    );
    const service = new PortabiliteService(db);

    await service.exporter(FOYER_ID);

    const rendus = conditions.map(rendre);
    expect(rendus).toHaveLength(8);
    // foyer, foyer_version, correction_journal, enfant, parent, journal_audit →
    // tous sur le foyer.
    for (const rendu of rendus.slice(0, 6)) {
      expect(rendu.params).toEqual([FOYER_ID]);
    }
    expect(rendus[0]?.sql).toContain('"id"');
    for (const rendu of rendus.slice(1, 6)) {
      expect(rendu.sql).toContain('"foyer_id"');
    }
    // preference_notification et desabonnement_token n'ont PAS de `foyer_id` :
    // elles se rattachent par `parent_id`, jamais par le foyer.
    for (const rendu of rendus.slice(6)) {
      expect(rendu.params).toEqual([PARENT_ID]);
      expect(rendu.sql).toContain('"parent_id"');
      expect(rendu.sql).not.toContain('"foyer_id"');
    }
  });

  it('exporte les parents RETIRÉS, dont le nom et l’e-mail survivent au retrait', async () => {
    const { db } = fakeDbLecture(
      ...reponses([
        ligneParent(),
        ligneParent({
          id: PARENT_RETIRE_ID,
          email: 'ancien@example.test',
          principal: false,
          actif: false,
        }),
      ]),
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.parents).toHaveLength(2);
    const retire = vue.parents.find((p) => p.id === PARENT_RETIRE_ID);
    expect(retire).toMatchObject({
      email: 'ancien@example.test',
      actif: false,
      nom: 'Dupont',
    });
  });

  // L'historique des ressources est la donnée la plus sensible du document (des
  // revenus, datés) et la seule que le foyer ne puisse relire nulle part ailleurs
  // en entier. On y vérifie surtout la conversion des horodatages : une `Date`
  // laissée telle quelle sortirait en ISO par `JSON.stringify`, mais une colonne
  // renommée ou oubliée ne se verrait pas.
  it('rend l’historique des ressources, ses corrections et les enfants', async () => {
    const { db } = fakeDbLecture(
      [ligneFoyer()],
      [
        {
          id: 'v1',
          foyerId: FOYER_ID,
          dateEffet: '2026-01-01',
          ressourcesMensuellesCentimes: 350000,
          rfrCentimes: 7270500,
          nbEnfantsACharge: 2,
          nbParts: 3,
          saisiLe: LE,
          motif: 'avis d’imposition 2025',
          createdAt: LE,
        },
      ],
      [
        {
          id: 'c1',
          foyerId: FOYER_ID,
          versionId: 'v1',
          avant: { rfrCentimes: 7000000 },
          apres: { rfrCentimes: 7270500 },
          motif: 'erreur de saisie',
          creeLe: LE,
        },
      ],
      [
        {
          id: 'e1',
          foyerId: FOYER_ID,
          prenom: 'Mia',
          dateNaissance: '2024-12-08',
          createdAt: LE,
        },
      ],
      [ligneParent()],
      [],
      [],
      [],
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.situationCourante).toMatchObject({
      id: FOYER_ID,
      rfrCentimes: 7270500,
      creeLe: LE.toISOString(),
    });
    expect(vue.versionsRessources).toEqual([
      {
        dateEffet: '2026-01-01',
        ressourcesMensuellesCentimes: 350000,
        rfrCentimes: 7270500,
        nbEnfantsACharge: 2,
        nbParts: 3,
        saisiLe: LE.toISOString(),
        motif: 'avis d’imposition 2025',
      },
    ]);
    expect(vue.correctionsRessources).toEqual([
      {
        avant: { rfrCentimes: 7000000 },
        apres: { rfrCentimes: 7270500 },
        motif: 'erreur de saisie',
        corrigeLe: LE.toISOString(),
      },
    ]);
    expect(vue.enfants).toEqual([
      {
        prenom: 'Mia',
        dateNaissance: '2024-12-08',
        ajouteLe: LE.toISOString(),
      },
    ]);
  });

  // Le piège du lot : dans `preference_notification`, l'ABSENCE de ligne vaut
  // consentement. Exporter les seules lignes stockées livrerait les écarts au
  // défaut en les présentant comme l'état complet — donc une donnée fausse.
  it('exporte les préférences EFFECTIVES : la matrice complète, une combinaison sans ligne étant INACTIVE', async () => {
    // `AM-57` : l'export sort les deux combinaisons de la matrice §5.1 — sinon il
    // livrerait les seules combinaisons renseignées en les présentant comme l'état
    // complet. Une combinaison **sans ligne** n'a aucun consentement enregistré et
    // s'exporte donc inactive : c'est ce que le service en fait, dire l'inverse dans
    // un document remis au parent serait faux.
    const { db } = fakeDbLecture(...reponses([ligneParent()], []));
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.preferencesNotification).toEqual([
      {
        parentId: PARENT_ID,
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'EMAIL',
        actif: false,
        consentementLe: null,
        desabonneLe: null,
      },
      {
        parentId: PARENT_ID,
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'IN_APP',
        actif: false,
        consentementLe: null,
        desabonneLe: null,
      },
    ]);
  });

  it('fait primer le choix stocké sur le défaut, avec ses horodatages de consentement', async () => {
    const desabonneLe = new Date('2026-07-01T10:00:00.000Z');
    const { db } = fakeDbLecture(
      ...reponses(
        [ligneParent()],
        [
          {
            id: 'pref-1',
            parentId: PARENT_ID,
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'EMAIL',
            actif: false,
            consentementAt: null,
            desabonneAt: desabonneLe,
            sourceDernier: 'ECRAN',
            createdAt: LE,
            updatedAt: LE,
          },
        ],
      ),
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.preferencesNotification[0]).toEqual({
      parentId: PARENT_ID,
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
      actif: false,
      consentementLe: null,
      desabonneLe: desabonneLe.toISOString(),
    });
  });

  // Un jeton de désabonnement est une CAPACITÉ : il agit sans authentification.
  // Recopié dans un fichier téléchargé, il resterait actionnable par quiconque le
  // lit. La trace part, le secret reste.
  it('n’exporte JAMAIS le `jti` d’un jeton de désabonnement', async () => {
    const { db } = fakeDbLecture(
      ...reponses(
        [ligneParent()],
        [],
        [
          {
            jti: '99999999-0000-4000-8000-000000000000',
            parentId: PARENT_ID,
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'EMAIL',
            emisLe: LE,
            utiliseLe: null,
            expireLe: new Date('2026-09-12T06:00:00.000Z'),
          },
        ],
      ),
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.jetonsDesabonnement).toHaveLength(1);
    expect(vue.jetonsDesabonnement[0]).toEqual({
      parentId: PARENT_ID,
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
      emisLe: LE.toISOString(),
      utiliseLe: null,
      expireLe: '2026-09-12T06:00:00.000Z',
    });
    // Sonde de fond : le `jti` ne doit apparaître nulle part dans le document,
    // pas seulement hors de la section des jetons.
    expect(JSON.stringify(vue)).not.toContain('99999999');
  });

  // `inArray(colonne, [])` produit un prédicat que Postgres refuse : sans cette
  // garde, un foyer sans parent ferait échouer tout l'export.
  it('n’interroge pas les tables filles quand le foyer n’a aucun parent', async () => {
    const { db, nbSelect } = fakeDbLecture(...reponses([]));
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.preferencesNotification).toEqual([]);
    expect(vue.jetonsDesabonnement).toEqual([]);
    // foyer + versions + corrections + enfants + parents + audit = 6, rien de plus.
    expect(nbSelect()).toBe(6);
  });

  /**
   * La piste d'audit (lot 6) est le seul endroit où le foyer lit **qui** a changé
   * son dossier ; c'est le sens donné à « consultable » dans le critère d'`AM-45`.
   * Un acteur non établi sort tel quel : l'export dit le trou plutôt que de le taire.
   */
  it('rend la piste d’audit, acteur compris, y compris quand il est inconnu', async () => {
    const { db } = fakeDbLecture(
      ...reponses(
        [ligneParent()],
        [],
        [],
        [
          {
            id: 'a1',
            foyerId: FOYER_ID,
            action: 'parent.retire',
            cibleType: 'parent',
            cibleId: PARENT_RETIRE_ID,
            acteurType: 'parent',
            acteur: 'alex@example.test',
            creeLe: LE,
          },
          {
            id: 'a2',
            foyerId: FOYER_ID,
            action: 'foyer.ressources.saisies',
            cibleType: 'foyer_version',
            cibleId: null,
            acteurType: 'inconnu',
            acteur: null,
            creeLe: LE,
          },
        ],
      ),
    );
    const service = new PortabiliteService(db);

    const vue = await service.exporter(FOYER_ID);

    expect(vue.pisteAudit).toEqual([
      {
        action: 'parent.retire',
        cibleType: 'parent',
        cibleId: PARENT_RETIRE_ID,
        acteurType: 'parent',
        acteur: 'alex@example.test',
        le: LE.toISOString(),
      },
      {
        action: 'foyer.ressources.saisies',
        cibleType: 'foyer_version',
        cibleId: null,
        acteurType: 'inconnu',
        acteur: null,
        le: LE.toISOString(),
      },
    ]);
  });
});
