import { describe, expect, it, vi } from 'vitest';
import {
  AucuneVersionApplicableError,
  ModeGardeInconnuError,
  PeriodeInvalideError,
  TrancheInconnueError,
  VersionsChevauchantesError,
} from '@creche-planner/referentiel-domain';
import {
  GRILLE_PUBLIEE_TYPE,
  MODES_ABCM_CONTRAT,
} from '@creche-planner/contracts-referentiel';
import { ReferentielService } from './referentiel.service.js';
import type { Database } from '../database/database.types.js';
import type { BaremePsuRow, GrilleAbcmRow } from '../database/schema.js';
import type { PublierGrilleAbcmDto } from './referentiel.dto.js';

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
          type: GRILLE_PUBLIEE_TYPE,
          payload: expect.objectContaining({
            grilleId: vue.id,
            mode,
            tranche: 3,
            valideDu: '2026-01-01',
            valideAu: null,
          }),
        }),
      );
    }
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

describe('ReferentielService.fraisFixesApplicable', () => {
  it('sélectionne les frais fixes couvrant la date', async () => {
    const db = fakeDbLecture([
      {
        id: '66666666-0000-4000-8000-000000000000',
        valideDu: '2025-09-01',
        valideAu: '2026-08-31',
        cotisation1EnfantCentimes: 2600,
        premiereInscriptionCentimes: 800,
        createdAt: new Date('2025-09-01T00:00:00Z'),
      },
      {
        id: '66666666-0000-4000-8000-000000000001',
        valideDu: '2026-09-01',
        valideAu: null,
        cotisation1EnfantCentimes: 2800,
        premiereInscriptionCentimes: 900,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);
    const service = new ReferentielService(db);

    await expect(service.fraisFixesApplicable('2026-10-01')).resolves.toEqual({
      valideDu: '2026-09-01',
      valideAu: null,
      cotisation1EnfantCentimes: 2800,
      premiereInscriptionCentimes: 900,
    });
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
