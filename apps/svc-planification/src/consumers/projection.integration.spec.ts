import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Column,
  eq,
  getTableColumns,
  getTableName,
  is,
  Param,
  Table,
} from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { FOYER_SUPPRIME_TYPE } from '@creche-planner/contracts-foyer';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import * as schema from '../database/schema.js';
import {
  contrat,
  contratVersion,
  correctionJournal,
  deadLetter,
  etablissement,
  outbox,
  planningMois,
  processedEvent,
} from '../database/schema.js';

/**
 * Test d'**intégration** de l'effacement d'un foyer (`FoyerSupprime`, doc 37 §3) :
 * contrairement à `projection.service.spec.ts` (aiguillage, fake sans état, qui
 * observe la **séquence** des `delete`), on vérifie ici le **résidu** — « il ne
 * reste rien » — sans Postgres.
 *
 * La base factice est **à état**, et surtout elle honore les **contraintes de clé
 * étrangère déclarées dans le schéma**, lues par introspection Drizzle
 * (`getTableConfig(...).foreignKeys`) : `ON DELETE cascade` propage la suppression,
 * toute autre action (`no action`, le défaut) la **refuse** comme le ferait Postgres.
 * Sans cela, l'oracle serait creux sur ce service précis :
 *
 * - trois tables (`contrat_version`, `correction_journal`, `planning_mois`) ne sont
 *   **jamais** citées par le handler — elles disparaissent par la cascade SQL. Un
 *   fake sans FK les laisserait pleines et ferait échouer un test pourtant correct ;
 * - l'ordre `contrat` → `etablissement` n'est pas un détail de style : la FK
 *   `contrat.etablissement_id` est en `no action`, l'ordre inverse ferait échouer
 *   toute la transaction. Avec les FK simulées, le simple fait que l'effacement
 *   réponde `TRAITE` **prouve** l'ordre.
 *
 * Les prédicats supportés sont ceux que le handler émet, et eux seuls :
 * `eq(colonne, valeur)` et `like(colonne, '%valeur%')`. La distinction se lit dans
 * les `queryChunks` : drizzle **lie** la valeur d'un `eq` (`Param`) mais laisse le
 * motif d'un `like` en chaîne nue (`sql\`${column} like ${value}\``, sans
 * `bindIfParam`).
 */

type Ligne = Record<string, unknown>;

/**
 * Toutes les tables du schéma — support de l'introspection des FK entrantes. Le
 * passage par `unknown` est nécessaire : `Object.values(schema)` a pour type l'union
 * des tables **concrètes** (chacune avec son nom littéral), à laquelle un prédicat
 * sur le `Table` générique n'est pas assignable.
 */
const TABLES: Table[] = (Object.values(schema) as unknown[]).filter(
  (v): v is Table => is(v, Table),
);

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
  /** Nom de propriété TS d'une colonne dans sa table (ex. `foyer_id` → `foyerId`). */
  const cleDe = (table: Table, colonne: Column): string => {
    const entree = Object.entries(getTableColumns(table)).find(
      ([, c]) => c === colonne,
    );
    if (!entree) {
      throw new Error(`colonne inconnue dans la table : ${colonne.name}`);
    }
    return entree[0];
  };
  /** Clé TS d'une colonne à partir de son nom SQL (ex. `contrat_id` → `contratId`). */
  const cleDepuisNomSql = (table: Table, nomSql: string): string => {
    const entree = Object.entries(getTableColumns(table)).find(
      ([, c]) => c.name === nomSql,
    );
    if (!entree) {
      throw new Error(
        `colonne inconnue dans ${getTableName(table)} : ${nomSql}`,
      );
    }
    return entree[0];
  };
  /** Évalue un `eq(colonne, valeur)` **ou** un `like(colonne, '%valeur%')`. */
  const filtre = (
    table: Table,
    condition: unknown,
  ): ((ligne: Ligne) => boolean) => {
    const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
    const colonne = chunks.find((c) => c instanceof Column) as Column;
    const cle = cleDe(table, colonne);
    const motif = chunks.find((c) => typeof c === 'string');
    if (typeof motif === 'string') {
      if (!motif.startsWith('%') || !motif.endsWith('%')) {
        throw new Error(`motif like non supporté : ${motif}`);
      }
      const noyau = motif.slice(1, -1);
      return (ligne: Ligne) => String(ligne[cle]).includes(noyau);
    }
    const param = chunks.find((c) => c instanceof Param) as Param;
    return (ligne: Ligne) => ligne[cle] === param.value;
  };
  /**
   * Clés étrangères **pointant vers** `parent`, lues dans le schéma. Une FK est
   * déclarée par la table fille : pour savoir ce qu'emporte la suppression d'un
   * parent, il faut donc balayer toutes les tables.
   */
  const fkEntrantes = (
    parent: Table,
  ): {
    fille: Table;
    cleFille: string;
    clePere: string;
    action: string | undefined;
  }[] =>
    TABLES.flatMap((fille) =>
      getTableConfig(fille as PgTable).foreignKeys.flatMap((fk) => {
        const ref = fk.reference();
        if (getTableName(ref.foreignTable) !== getTableName(parent)) {
          return [];
        }
        const colFille = ref.columns[0];
        const colPere = ref.foreignColumns[0];
        if (!colFille || !colPere) {
          return [];
        }
        return [
          {
            fille,
            cleFille: cleDepuisNomSql(fille, colFille.name),
            clePere: cleDepuisNomSql(parent, colPere.name),
            action: fk.onDelete,
          },
        ];
      }),
    );
  /**
   * Supprime les lignes correspondantes en appliquant les FK entrantes : `cascade`
   * propage, toute autre action **refuse** la suppression (comportement Postgres par
   * défaut). C'est ce refus qui donne des dents à l'oracle d'ordre.
   */
  const supprimer = (table: Table, correspond: (l: Ligne) => boolean): void => {
    const lignes = lignesDe(table);
    const cibles = lignes.filter(correspond);
    if (cibles.length === 0) {
      return;
    }
    for (const fk of fkEntrantes(table)) {
      const valeurs = new Set(cibles.map((l) => l[fk.clePere]));
      const referencantes = lignesDe(fk.fille).filter((l) =>
        valeurs.has(l[fk.cleFille]),
      );
      if (referencantes.length === 0) {
        continue;
      }
      if (fk.action === 'cascade') {
        supprimer(fk.fille, (l) => valeurs.has(l[fk.cleFille]));
      } else {
        throw new Error(
          `update or delete on table "${getTableName(table)}" violates foreign key constraint on table "${getTableName(fk.fille)}"`,
        );
      }
    }
    lignes.splice(0, lignes.length, ...lignes.filter((l) => !correspond(l)));
  };

  const operations = {
    insert: (table: Table) => ({
      values: (brutes: Ligne) => ({
        // Marqueur d'idempotence : n'insère que si la clé est nouvelle.
        onConflictDoNothing: (opts: { target: Column }) => ({
          returning: () => {
            const cle = cleDe(table, opts.target);
            const doublon = lignesDe(table).some((l) => l[cle] === brutes[cle]);
            if (doublon) {
              return Promise.resolve([]);
            }
            lignesDe(table).push({ ...brutes });
            return Promise.resolve([{ id: brutes['id'] }]);
          },
        }),
      }),
    }),
    delete: (table: Table) => ({
      where: (condition: unknown) => {
        supprimer(table, filtre(table, condition));
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
const AUTRE_FOYER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ID_SUPPR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function evenementFoyerSupprime(id: string): unknown {
  return {
    id,
    type: FOYER_SUPPRIME_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2027-02-01T00:00:00.000Z',
    traceId: 'trace-suppr',
    payload: {
      foyerId: FOYER_ID,
      // Portés pour svc-notifications (boîte in-app clée par parent) ; sans usage
      // ici : aucune table de Planification n'est clée par parent.
      parentIds: [
        '77777777-0000-4000-8000-000000000001',
        '77777777-0000-4000-8000-000000000002',
      ],
    },
  };
}

/**
 * Peuple les 6 tables porteuses de donnée personnelle pour un foyer. Contrairement
 * aux services de projection pure, Planification est **propriétaire** de ces tables :
 * elles sont écrites par sa couche domaine/REST, pas par un événement. Il n'existe
 * donc aucun « vrai événement » de peuplement à rejouer — l'écriture directe est ici
 * la seule voie fidèle. `dead_letter`, elle, est alimentée par le harnais de
 * consommation (`nest-commons`) : on y dépose la ligne telle qu'elle existe en prod,
 * soit le **payload en clair** d'un événement du stream FOYER que ce service ne
 * consomme pas (`TYPE_INCONNU`).
 */
function peupler(
  lignesDe: (t: Table) => Ligne[],
  foyerId: string,
): { contratId: string; etablissementId: string } {
  const etablissementId = randomUUID();
  const contratId = randomUUID();
  lignesDe(etablissement).push({
    id: etablissementId,
    foyerId,
    nom: 'Crèche Les Hirondelles',
    emailService: 'contact@creche.example',
    preavisRegle: null,
    types: ['CRECHE_PSU'],
    adresse: '1 rue des Lilas',
    telephone: '0388000000',
    contact: 'Mme Martin',
    actif: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  lignesDe(contrat).push({
    id: contratId,
    foyerId,
    enfant: 'Mia',
    enfantId: randomUUID(),
    mode: 'CRECHE_PSU',
    etablissementId,
    valideDu: '2026-01-01',
    valideAu: null,
    premiereInscription: false,
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: null,
    semaineAbcm: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  lignesDe(contratVersion).push({
    id: randomUUID(),
    contratId,
    dateEffet: '2026-01-01',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: null,
    semaineAbcm: null,
    saisiLe: new Date(),
    motif: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  lignesDe(correctionJournal).push({
    id: randomUUID(),
    contratId,
    versionId: randomUUID(),
    avant: { heuresAnnuellesContractualisees: 831.5 },
    apres: { heuresAnnuellesContractualisees: 885.5 },
    motif: 'erreur de saisie',
    corrigeLe: new Date(),
  });
  lignesDe(planningMois).push({
    id: randomUUID(),
    contratId,
    mois: '2026-10',
    simule: false,
    saisie: { absences: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  lignesDe(deadLetter).push({
    id: randomUUID(),
    envelopeId: randomUUID(),
    stream: 'FOYER',
    sujet: 'foyer.ParentAjoute.v1',
    raison: 'TYPE_INCONNU',
    payload: JSON.stringify({
      type: 'foyer.ParentAjoute.v1',
      payload: { foyerId, prenom: 'Camille', email: 'camille@example.com' },
    }),
    erreur: null,
    livraisons: 1,
    createdAt: new Date(),
  });
  return { contratId, etablissementId };
}

/** Tables que l'effacement doit vider, directement ou par cascade SQL. */
const tablesEffacees: [string, Table][] = [
  ['contrat', contrat],
  ['contrat_version', contratVersion],
  ['correction_journal', correctionJournal],
  ['planning_mois', planningMois],
  ['etablissement', etablissement],
  ['dead_letter', deadLetter],
];

/**
 * **Sonde négative du harnais lui-même.** Les tests d'effacement plus bas ne valent
 * que si la base factice sait vraiment refuser une violation de FK et vraiment
 * cascader : sinon un handler écrit dans le mauvais ordre répondrait `TRAITE` et
 * l'oracle serait creux. On le vérifie AVANT, sur la base nue.
 */
describe('Base factice : les contraintes FK du schéma sont réellement appliquées', () => {
  it('refuse de supprimer un etablissement encore référencé par un contrat (no action)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    peupler(lignesDe, FOYER_ID);

    // Le refus est levé pendant la construction de la requête (la base factice est
    // synchrone) : il faut donc une fonction, sinon l'erreur échappe à `expect`.
    await expect(async () => {
      await db.delete(etablissement).where(eq(etablissement.foyerId, FOYER_ID));
    }).rejects.toThrow(/violates foreign key constraint/);
    expect(lignesDe(etablissement)).toHaveLength(1);
  });

  it('supprimer un contrat emporte ses 3 tables filles (ON DELETE cascade)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    peupler(lignesDe, FOYER_ID);

    await db.delete(contrat).where(eq(contrat.foyerId, FOYER_ID));

    expect(lignesDe(contratVersion)).toHaveLength(0);
    expect(lignesDe(correctionJournal)).toHaveLength(0);
    expect(lignesDe(planningMois)).toHaveLength(0);
  });
});

/**
 * **Droit à l'effacement** (`FoyerSupprime`, doc 37 §3). L'oracle utile n'est pas
 * « le handler a tourné » mais « il ne reste **rien** » : on peuple chaque table
 * concernée, on livre l'enveloppe, on compte les résidus. Une table oubliée est une
 * donnée personnelle qui survit, invisible à tout autre test.
 *
 * La **sonde négative** est indissociable de cet oracle : sans un second foyer laissé
 * intact, une purge trop gourmande (un `delete` sans `where`, un filtre `like` trop
 * large) passerait pour un succès.
 */
describe('Effacement du foyer (FoyerSupprime — résidu, ordre et sonde négative)', () => {
  it('oracle de résidu : après FoyerSupprime, AUCUNE ligne du foyer ne subsiste', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID);

    // Garde-fou du test lui-même : un peuplement raté rendrait l'oracle vide, donc
    // vert quoi que fasse le handler.
    for (const [nom, table] of tablesEffacees) {
      expect(lignesDe(table), `peuplement de ${nom}`).toHaveLength(1);
    }

    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR)),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(contrat)).toHaveLength(0);
    expect(lignesDe(contratVersion)).toHaveLength(0);
    expect(lignesDe(correctionJournal)).toHaveLength(0);
    expect(lignesDe(planningMois)).toHaveLength(0);
    expect(lignesDe(etablissement)).toHaveLength(0);
    expect(lignesDe(deadLetter)).toHaveLength(0);
  });

  it('l’ordre des DELETE tient face à la FK : `TRAITE` et non un échec de contrainte', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID);

    // Preuve sémantique de l'ordre : la base factice refuse de vider
    // `etablissement` tant qu'un `contrat` le référence (cf. describe précédent).
    // Un handler qui inverserait les deux DELETE ferait échouer la transaction,
    // donc renverrait ECHEC_TRANSITOIRE et laisserait des résidus.
    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR)),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(etablissement)).toHaveLength(0);
  });

  it('sonde négative : le foyer voisin survit intégralement à l’effacement', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID);
    peupler(lignesDe, AUTRE_FOYER_ID);

    await projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR));

    // Exactement une ligne par table, et c'est toujours celle de l'autre foyer.
    for (const [nom, table] of tablesEffacees) {
      expect(lignesDe(table), `résidu attendu dans ${nom}`).toHaveLength(1);
    }
    expect(lignesDe(contrat)[0]).toMatchObject({ foyerId: AUTRE_FOYER_ID });
    expect(lignesDe(etablissement)[0]).toMatchObject({
      foyerId: AUTRE_FOYER_ID,
    });
    // Les filles n'ont pas de `foyer_id` : leur survie se lit sur le contrat parent.
    expect(lignesDe(contratVersion)[0]?.['contratId']).toBe(
      lignesDe(contrat)[0]?.['id'],
    );
    expect(lignesDe(correctionJournal)[0]?.['contratId']).toBe(
      lignesDe(contrat)[0]?.['id'],
    );
    expect(lignesDe(planningMois)[0]?.['contratId']).toBe(
      lignesDe(contrat)[0]?.['id'],
    );
    // Le filtre `like` sur le texte du payload ne doit pas déborder sur le voisin.
    expect(String(lignesDe(deadLetter)[0]?.['payload'])).toContain(
      AUTRE_FOYER_ID,
    );
  });

  it('processed_event et outbox ne sont PAS purgées par l’effacement', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID);
    // File de publication **vivante** : une ligne non publiée est un événement en
    // vol, la supprimer l'annulerait. Sa borne est temporelle (doc 37 §3 T7).
    lignesDe(outbox).push({
      id: randomUUID(),
      type: 'planification.ContratModifie.v1',
      payload: { foyerId: FOYER_ID },
      occurredAt: new Date(),
      traceId: 'trace-outbox',
      publishedAt: null,
    });

    await projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR));

    // Le marqueur de l'effacement lui-même : l'effacer rouvrirait la porte à une
    // re-projection du foyer à la prochaine re-livraison JetStream.
    expect(lignesDe(processedEvent)).toHaveLength(1);
    expect(lignesDe(processedEvent)[0]).toMatchObject({
      id: ID_SUPPR,
      type: FOYER_SUPPRIME_TYPE,
    });
    expect(lignesDe(outbox)).toHaveLength(1);
  });

  it('idempotence rejouée : l’enveloppe d’effacement ré-livrée ne re-supprime rien', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID);
    await projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR));
    expect(lignesDe(contrat)).toHaveLength(0);

    // Cas réel : une écriture encore en cours au moment de l'effacement re-crée des
    // lignes (l'ordre entre l'API locale et la livraison JetStream n'est pas garanti)…
    peupler(lignesDe, FOYER_ID);
    expect(lignesDe(contrat)).toHaveLength(1);

    // …puis JetStream re-livre l'enveloppe d'effacement (at-least-once) : elle est
    // acquittée en no-op, elle ne re-purge pas.
    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_SUPPR)),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });
});
