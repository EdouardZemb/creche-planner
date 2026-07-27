import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  AucuneVersionApplicableError,
  ModeGardeInconnuError,
  PeriodeInvalideError,
  TrancheInconnueError,
  VersionsChevauchantesError,
} from '@creche-planner/referentiel-domain';
import {
  BAREME_PSU_PUBLIE_TYPE,
  GRILLE_PUBLIEE_V2_TYPE,
  MODES_ABCM_CONTRAT,
} from '@creche-planner/contracts-referentiel';
import { ReferentielService } from './referentiel.service.js';
import type { Database } from '../database/database.types.js';
import type { BaremePsuRow, GrilleAbcmRow } from '../database/schema.js';
import type {
  PublierBaremePsuDto,
  PublierGrilleAbcmDto,
} from './referentiel.dto.js';

/**
 * Tests unitaires du `ReferentielService` SANS infra (Postgres mocké), AQ-08. Même
 * motif que `planification.service.spec.ts` : faux `db` aux chaînes Drizzle
 * espionnables. Les cas à risque ciblés par l'audit (doc 27) : **chevauchement de
 * période refusé**, sélection de la version applicable à une date, versionnement
 * (nouvelle fenêtre de validité), un événement outbox **par mode ABCM** dans la
 * même transaction que la grille. Le SQL réel reste couvert par la vérification
 * Pact provider (base réelle en CI).
 */

const GRILLE_ID = '44444444-0000-4000-8000-000000000000';

/** DTO de publication valide (montants en euros, tranche 3). */
const DTO_GRILLE: PublierGrilleAbcmDto = {
  tranche: 3,
  valideDu: '2026-01-01',
  valideAu: null,
  cantineTotal: 5.4,
  cantinePartGarde: 2.7,
  periMatin: 1.2,
  periSoir: 2.3,
  alshJourneeComplete: 12.5,
  alshDemiJournee: 7.25,
  alshRepas: 3.1,
};

function ligneGrille(overrides: Partial<GrilleAbcmRow> = {}): GrilleAbcmRow {
  return {
    id: GRILLE_ID,
    tranche: 3,
    valideDu: '2026-01-01',
    valideAu: null,
    cantineTotalCentimes: 540,
    cantinePartGardeCentimes: 270,
    periMatinCentimes: 120,
    periSoirCentimes: 230,
    alshJourneeCompleteCentimes: 1250,
    alshDemiJourneeCentimes: 725,
    alshRepasCentimes: 310,
    versionPayload: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function ligneBareme(overrides: Partial<BaremePsuRow> = {}): BaremePsuRow {
  return {
    id: '55555555-0000-4000-8000-000000000000',
    valideDu: '2026-01-01',
    valideAu: null,
    taux: { '1': 0.000619, '2': 0.000516 },
    plancherCentimes: 80000,
    plafondCentimes: 700000,
    versionPayload: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Faux `db` pour `publierGrilleAbcm` : le `select` (grilles existantes de la
 * tranche, AVANT la transaction) renvoie `existantes` ; la transaction expose un
 * `insert(...).values(...)` espionné (grille + une ligne outbox par mode ABCM).
 */
function fakeDbPublication(existantes: GrilleAbcmRow[]): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn(() => Promise.resolve());
  const tx = { insert: () => ({ values: insertValues }) };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(existantes) }),
  }));
  const db = { select, transaction } as unknown as Database;
  return { db, transaction, insertValues, select };
}

/**
 * Faux `db` de lecture : chaque `select()` consomme la réponse suivante. Chaque
 * maillon (`from`, `where`, `orderBy`) renvoie une **promesse augmentée** de la
 * chaîne : les barèmes/frais fixes sont lus par `select().from(...)` SANS `where`
 * (table entière), il faut donc que `from()` soit déjà awaitable.
 */
function fakeDbLecture(...reponses: unknown[][]): Database {
  let i = 0;
  const select = vi.fn(() => {
    const lignes = reponses[i++] ?? [];
    const chaine: Record<string, unknown> = {};
    const maillon = () => Object.assign(Promise.resolve(lignes), chaine);
    chaine['from'] = vi.fn(maillon);
    chaine['where'] = vi.fn(maillon);
    chaine['orderBy'] = vi.fn(maillon);
    return chaine;
  });
  return { select } as unknown as Database;
}

describe('ReferentielService.publierGrilleAbcm (versionnement + outbox)', () => {
  it('insère la grille + un GrillePubliee PAR mode ABCM dans UNE seule transaction', async () => {
    const { db, transaction, insertValues } = fakeDbPublication([]);
    const service = new ReferentielService(db);

    const vue = await service.publierGrilleAbcm(DTO_GRILLE);

    expect(transaction).toHaveBeenCalledTimes(1);
    // Montants convertis en centimes entiers (fidèle à Money).
    expect(vue).toMatchObject({
      tranche: 3,
      cantineTotalCentimes: 540,
      cantinePartGardeCentimes: 270,
      periMatinCentimes: 120,
      periSoirCentimes: 230,
      alshJourneeCompleteCentimes: 1250,
      alshDemiJourneeCentimes: 725,
      alshRepasCentimes: 310,
    });
    // 1 insert grille + 1 événement par mode ABCM (PERISCOLAIRE/CANTINE/ALSH).
    expect(insertValues).toHaveBeenCalledTimes(1 + MODES_ABCM_CONTRAT.length);
    for (const mode of MODES_ABCM_CONTRAT) {
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          type: GRILLE_PUBLIEE_V2_TYPE,
          payload: expect.objectContaining({
            grilleId: vue.id,
            mode,
            tranche: 3,
            valideDu: '2026-01-01',
            valideAu: null,
            parametres: expect.any(Object),
          }),
        }),
      );
    }
    // La v2 CANTINE porte les montants de la cantine (D1) ; les autres modes non.
    const eventCantine = insertValues.mock.calls
      .map((appel) => appel[0] as { payload?: { mode?: string } })
      .find((v) => v.payload?.mode === 'CANTINE');
    expect(eventCantine?.payload).toMatchObject({
      parametres: { cantineTotalCentimes: 540, cantinePartGardeCentimes: 270 },
    });
    // La grille est marquée version_payload = 2 (pas de ré-émission au boot).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ versionPayload: 2, tranche: 3 }),
    );
  });

  it("VALIDE l'entrée via Zod EN TÊTE (parse déplacé du pipe HTTP vers le service) — entrée invalide rejetée avant tout accès base", async () => {
    const { db, select, transaction } = fakeDbPublication([]);
    const service = new ReferentielService(db);

    // Montant négatif : refusé par `publierGrilleAbcmSchema` (nonnegative), donc
    // le parse en tête lève AVANT toute lecture ou transaction. Prouve que les
    // grilles seedées passent la même validation (plus de pipe HTTP).
    await expect(
      service.publierGrilleAbcm({ ...DTO_GRILLE, cantineTotal: -1 }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('cantinePartGarde absente → null en vue (pas de 0 implicite)', async () => {
    const { db } = fakeDbPublication([]);
    const service = new ReferentielService(db);

    const vue = await service.publierGrilleAbcm({
      ...DTO_GRILLE,
      cantinePartGarde: undefined,
    });
    expect(vue.cantinePartGardeCentimes).toBeNull();
  });

  it('REFUSE un chevauchement de période avec une grille existante de la même tranche — aucune écriture', async () => {
    // Période ouverte existante [2026-01-01..∞[ : toute nouvelle fenêtre chevauche.
    const { db, transaction, insertValues } = fakeDbPublication([
      ligneGrille(),
    ]);
    const service = new ReferentielService(db);

    await expect(
      service.publierGrilleAbcm({ ...DTO_GRILLE, valideDu: '2026-09-01' }),
    ).rejects.toBeInstanceOf(VersionsChevauchantesError);
    expect(transaction).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('versionnement : une nouvelle fenêtre DISJOINTE est acceptée (nouvelle version de la grille)', async () => {
    const { db, transaction } = fakeDbPublication([
      ligneGrille({ valideDu: '2025-01-01', valideAu: '2025-12-31' }),
    ]);
    const service = new ReferentielService(db);

    await expect(service.publierGrilleAbcm(DTO_GRILLE)).resolves.toMatchObject({
      valideDu: '2026-01-01',
      valideAu: null,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('tranche inconnue refusée par le domaine AVANT tout accès base', async () => {
    const { db, select, transaction } = fakeDbPublication([]);
    const service = new ReferentielService(db);

    await expect(
      service.publierGrilleAbcm({ ...DTO_GRILLE, tranche: 4 }),
    ).rejects.toBeInstanceOf(TrancheInconnueError);
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('période incohérente (fin antérieure au début) refusée AVANT tout accès base', async () => {
    const { db, select } = fakeDbPublication([]);
    const service = new ReferentielService(db);

    await expect(
      service.publierGrilleAbcm({
        ...DTO_GRILLE,
        valideDu: '2026-12-31',
        valideAu: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(PeriodeInvalideError);
    expect(select).not.toHaveBeenCalled();
  });
});

describe('ReferentielService.grilleApplicable (sélection par date)', () => {
  it('sélectionne la fenêtre couvrant la date parmi plusieurs versions (CANTINE)', async () => {
    const v2025 = ligneGrille({
      id: '44444444-0000-4000-8000-000000000001',
      valideDu: '2025-01-01',
      valideAu: '2025-12-31',
      cantineTotalCentimes: 500,
    });
    const db = fakeDbLecture([v2025, ligneGrille()]);
    const service = new ReferentielService(db);

    const grille = await service.grilleApplicable('2026-06-15', 'CANTINE', 3);
    expect(grille).toEqual({
      mode: 'CANTINE',
      tranche: 3,
      valideDu: '2026-01-01',
      valideAu: null,
      totalCentimes: 540,
      partGardeCentimes: 270,
    });
  });

  it('PERISCOLAIRE : projette matin/soir de la grille applicable', async () => {
    const db = fakeDbLecture([ligneGrille()]);
    const service = new ReferentielService(db);

    const grille = await service.grilleApplicable(
      '2026-06-15',
      'PERISCOLAIRE',
      3,
    );
    expect(grille).toMatchObject({
      mode: 'PERISCOLAIRE',
      matinCentimes: 120,
      soirCentimes: 230,
    });
  });

  it('ALSH : projette journée complète / demi-journée / repas', async () => {
    const db = fakeDbLecture([ligneGrille()]);
    const service = new ReferentielService(db);

    const grille = await service.grilleApplicable('2026-06-15', 'ALSH', 3);
    expect(grille).toMatchObject({
      mode: 'ALSH',
      journeeCompleteCentimes: 1250,
      demiJourneeCentimes: 725,
      repasCentimes: 310,
    });
  });

  it('CRECHE_PSU : sélectionne le barème versionné (sans tranche)', async () => {
    const perime = ligneBareme({
      id: '55555555-0000-4000-8000-000000000001',
      valideDu: '2025-01-01',
      valideAu: '2025-12-31',
      plafondCentimes: 600000,
    });
    const db = fakeDbLecture([perime, ligneBareme()]);
    const service = new ReferentielService(db);

    const bareme = await service.grilleApplicable(
      '2026-06-15',
      'CRECHE_PSU',
      undefined,
    );
    expect(bareme).toEqual({
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
      taux: { '1': 0.000619, '2': 0.000516 },
      plancherCentimes: 80000,
      plafondCentimes: 700000,
    });
  });

  it('AUCUNE version applicable à la date → AucuneVersionApplicableError', async () => {
    const db = fakeDbLecture([
      ligneGrille({ valideDu: '2026-01-01', valideAu: null }),
    ]);
    const service = new ReferentielService(db);

    await expect(
      service.grilleApplicable('2024-06-15', 'CANTINE', 3),
    ).rejects.toBeInstanceOf(AucuneVersionApplicableError);
  });

  it('mode de garde inconnu → ModeGardeInconnuError', async () => {
    const service = new ReferentielService(fakeDbLecture());
    await expect(
      service.grilleApplicable('2026-06-15', 'GARDERIE', 3),
    ).rejects.toBeInstanceOf(ModeGardeInconnuError);
  });

  it('tranche manquante pour un mode ABCM → TrancheInconnueError', async () => {
    const service = new ReferentielService(fakeDbLecture());
    await expect(
      service.grilleApplicable('2026-06-15', 'CANTINE', undefined),
    ).rejects.toBeInstanceOf(TrancheInconnueError);
  });
});

/** DTO de publication de barème PSU valide (taux + bornes en euros). */
const DTO_BAREME: PublierBaremePsuDto = {
  valideDu: '2026-01-01',
  valideAu: null,
  taux: { '1': 0.000619, '2': 0.000516 },
  plancher: 800,
  plafond: 7000,
};

/**
 * Faux `db` pour `publierBaremePsu` : `select().from(baremePsu)` (table entière,
 * sans `where`) renvoie `existants` ; la transaction expose `insert().values()`.
 */
function fakeDbBareme(existants: BaremePsuRow[]): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn(() => Promise.resolve());
  const tx = { insert: () => ({ values: insertValues }) };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const select = vi.fn(() => ({ from: () => Promise.resolve(existants) }));
  const db = { select, transaction } as unknown as Database;
  return { db, transaction, insertValues, select };
}

/**
 * Faux `db` pour la ré-émission : `select().from(t).where(...)` renvoie `aReemettre`
 * (lignes sous le seuil `version_payload`) ; la transaction expose `insert().values()`
 * et `update().set().where()`.
 */
function fakeDbReemission(aReemettre: unknown[]): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  setWhere: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn(() => Promise.resolve());
  const setWhere = vi.fn(() => Promise.resolve());
  const tx = {
    insert: () => ({ values: insertValues }),
    update: () => ({ set: () => ({ where: setWhere }) }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(aReemettre) }),
  }));
  const db = { select, transaction } as unknown as Database;
  return { db, transaction, insertValues, setWhere };
}

describe('ReferentielService.publierBaremePsu (versionnement + outbox)', () => {
  it('insère le barème + un BaremePsuPublie dans UNE transaction (bornes euros → centimes)', async () => {
    const { db, transaction, insertValues } = fakeDbBareme([]);
    const service = new ReferentielService(db);

    const vue = await service.publierBaremePsu(DTO_BAREME);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(vue).toMatchObject({
      valideDu: '2026-01-01',
      valideAu: null,
      plancherCentimes: 80000,
      plafondCentimes: 700000,
    });
    // 1 insert barème (version_payload = 1) + 1 événement BaremePsuPublie.
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ versionPayload: 1 }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BAREME_PSU_PUBLIE_TYPE,
        payload: expect.objectContaining({
          baremeId: vue.id,
          taux: { '1': 0.000619, '2': 0.000516 },
          plancherCentimes: 80000,
          plafondCentimes: 700000,
        }),
      }),
    );
  });

  it('bornes absentes → null (pas de 0 implicite)', async () => {
    const { db } = fakeDbBareme([]);
    const service = new ReferentielService(db);

    const vue = await service.publierBaremePsu({
      valideDu: '2026-01-01',
      valideAu: null,
      taux: { '1': 0.0006 },
    });
    expect(vue.plancherCentimes).toBeNull();
    expect(vue.plafondCentimes).toBeNull();
  });

  it('REFUSE un chevauchement de période avec un barème existant — aucune écriture', async () => {
    const { db, transaction } = fakeDbBareme([ligneBareme()]);
    const service = new ReferentielService(db);

    await expect(
      service.publierBaremePsu({ ...DTO_BAREME, valideDu: '2026-09-01' }),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ReferentielService — ré-émission one-shot (rattrapage prod)', () => {
  it('reemettreGrillesEnV2 : ré-émet en v2 par mode + remonte version_payload à 2', async () => {
    const { db, transaction, insertValues, setWhere } = fakeDbReemission([
      ligneGrille({ versionPayload: 1 }),
    ]);
    const service = new ReferentielService(db);

    const n = await service.reemettreGrillesEnV2();

    expect(n).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    // Un événement v2 par mode ABCM + une mise à jour de version_payload.
    expect(insertValues).toHaveBeenCalledTimes(MODES_ABCM_CONTRAT.length);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: GRILLE_PUBLIEE_V2_TYPE }),
    );
    expect(setWhere).toHaveBeenCalledTimes(1);
  });

  it('reemettreGrillesEnV2 : rien à ré-émettre → aucune transaction', async () => {
    const { db, transaction } = fakeDbReemission([]);
    const service = new ReferentielService(db);

    expect(await service.reemettreGrillesEnV2()).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reemettreBaremesPsu : ré-émet le barème + remonte version_payload à 1', async () => {
    const { db, insertValues, setWhere } = fakeDbReemission([
      ligneBareme({ versionPayload: 0 }),
    ]);
    const service = new ReferentielService(db);

    const n = await service.reemettreBaremesPsu();

    expect(n).toBe(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BAREME_PSU_PUBLIE_TYPE,
        payload: expect.objectContaining({
          taux: { '1': 0.000619, '2': 0.000516 },
        }),
      }),
    );
    expect(setWhere).toHaveBeenCalledTimes(1);
  });

  it('reemettreBaremesPsu : rien à ré-émettre → 0', async () => {
    const { db, transaction } = fakeDbReemission([]);
    const service = new ReferentielService(db);

    expect(await service.reemettreBaremesPsu()).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ReferentielService.listerJoursNonFacturables', () => {
  it('projette les lignes en vues (jour/type/libellé)', async () => {
    const db = fakeDbLecture([
      {
        id: '77777777-0000-4000-8000-000000000000',
        jour: '2026-07-14',
        type: 'FERIE',
        libelle: 'Fête nationale',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    const service = new ReferentielService(db);

    await expect(service.listerJoursNonFacturables()).resolves.toEqual([
      { jour: '2026-07-14', type: 'FERIE', libelle: 'Fête nationale' },
    ]);
  });
});
