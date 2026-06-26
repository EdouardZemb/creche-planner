import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ENFANT_AJOUTE_TYPE,
  FOYER_MIS_A_JOUR_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
} from '@creche-planner/contracts-foyer';
import { FoyerService } from './foyer.service.js';
import type { Database } from '../database/database.types.js';
import type { FoyerRow, ParentRow } from '../database/schema.js';
import type { EcrireFoyerDto } from './foyer.dto.js';

/**
 * Tests unitaires du `FoyerService` SANS infra (Postgres mocké), AQ-08. Même motif
 * que `planification.service.spec.ts` : un faux `db` aux chaînes Drizzle
 * espionnables. Les cas à risque ciblés par l'audit (doc 27) : **transactionnalité
 * outbox** (événement inséré dans la même transaction que l'état), 404, validation
 * domaine avant toute écriture. La projection SQL réelle reste couverte par la
 * vérification Pact provider (base réelle en CI).
 */

const FOYER_ID = '22222222-2222-4222-8222-222222222222';

/** DTO de référence : RFR 72 705 € > 50 000 € ⇒ tranche 3 (doc 02 §0). */
const DTO_FOYER: EcrireFoyerDto = {
  ressourcesMensuelles: 3500,
  rfr: 72705,
  nbEnfantsACharge: 2,
  nbParts: 3,
};

function ligneFoyer(overrides: Partial<FoyerRow> = {}): FoyerRow {
  return {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 350000,
    rfrCentimes: 7270500,
    nbEnfantsACharge: 2,
    nbParts: 3,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Faux `db` transactionnel instrumenté. `insertValues` espionne tous les
 * `insert(...).values(...)` (foyer, enfant, outbox — discriminés par leur forme) ;
 * `values()` renvoie une promesse augmentée de `.returning()` pour la chaîne
 * d'insertion d'enfant. `lignesUpdate` pilote le retour de
 * `update().set().where().returning()` (vide ⇒ foyer introuvable) ;
 * `foyerPresent` pilote le `select` fait DANS la transaction (`ajouterEnfant`) ;
 * `echecOutbox` fait rejeter l'insert outbox (les lignes outbox portent `type`)
 * pour vérifier que l'échec se propage (rollback sur une vraie base).
 */
function fakeDbTransaction(
  options: {
    foyerPresent?: boolean;
    lignesUpdate?: FoyerRow[];
    echecOutbox?: boolean;
  } = {},
): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn((valeurs: Record<string, unknown>) => {
    const promesse =
      options.echecOutbox && typeof valeurs['type'] === 'string'
        ? Promise.reject(new Error('outbox indisponible'))
        : Promise.resolve();
    return Object.assign(promesse, {
      returning: () => Promise.resolve([valeurs]),
    });
  });
  const updateSet = vi.fn(() => ({
    where: () => ({
      returning: () => Promise.resolve(options.lignesUpdate ?? []),
    }),
  }));
  const lignes = options.foyerPresent ? [ligneFoyer()] : [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(lignes) }) }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, updateSet };
}

/**
 * Faux `db` pour les lectures hors transaction (`lister`, `obtenir`,
 * `listerEnfants`) : chaque `select()` consomme la réponse suivante, la chaîne
 * `from().where()/.orderBy()` résout vers ces lignes (motif de
 * `planification.service.spec.ts`).
 */
function fakeDbLecture(...reponses: unknown[][]): Database {
  let i = 0;
  const select = vi.fn(() => {
    const lignes = reponses[i++] ?? [];
    const chaine = {
      where: vi.fn(() => Object.assign(Promise.resolve(lignes), chaine)),
      orderBy: vi.fn(() => Promise.resolve(lignes)),
      from: vi.fn(() => chaine),
    };
    return chaine;
  });
  return { select } as unknown as Database;
}

describe('FoyerService.creer (transactionnalité outbox)', () => {
  it('insère le foyer + l’outbox FoyerMisAJour dans UNE seule transaction (centimes, tranche dérivée)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    const vue = await service.creer(DTO_FOYER);

    expect(transaction).toHaveBeenCalledTimes(1);
    // L'état : montants convertis en centimes entiers (fidèle à Money).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: vue.id,
        ressourcesMensuellesCentimes: 350000,
        rfrCentimes: 7270500,
        nbEnfantsACharge: 2,
        nbParts: 3,
      }),
    );
    // L'événement : même transaction, payload complet, tranche dérivée du RFR.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FOYER_MIS_A_JOUR_TYPE,
        payload: {
          foyerId: vue.id,
          ressourcesMensuellesCentimes: 350000,
          rfrCentimes: 7270500,
          nbEnfantsACharge: 2,
          nbParts: 3,
          tranche: 3,
        },
      }),
    );
    expect(vue).toMatchObject({
      ressourcesMensuellesEuros: 3500,
      rfrEuros: 72705,
      tranche: 3,
    });
  });

  it('INVARIANT : un échec de l’insert outbox se propage (rollback) — pas de foyer sans événement', async () => {
    const { db, transaction } = fakeDbTransaction({ echecOutbox: true });
    const service = new FoyerService(db);

    // L'échec survient DANS l'unique transaction : sur une vraie base, l'insert
    // du foyer est annulé avec celui de l'outbox (atomicité, doc 06 §8.4).
    await expect(service.creer(DTO_FOYER)).rejects.toThrow(
      'outbox indisponible',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('une validation domaine en échec (nbParts ≤ 0) ne touche JAMAIS la base', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    await expect(service.creer({ ...DTO_FOYER, nbParts: 0 })).rejects.toThrow(
      'nombre de parts invalide',
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.mettreAJour', () => {
  it('met à jour le foyer + ré-émet FoyerMisAJour dans la même transaction', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbTransaction({
      lignesUpdate: [ligneFoyer()],
    });
    const service = new FoyerService(db);

    const vue = await service.mettreAJour(FOYER_ID, DTO_FOYER);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ressourcesMensuellesCentimes: 350000,
        rfrCentimes: 7270500,
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FOYER_MIS_A_JOUR_TYPE,
        payload: expect.objectContaining({ foyerId: FOYER_ID, tranche: 3 }),
      }),
    );
    expect(vue.id).toBe(FOYER_ID);
  });

  it('lève NotFoundException si le foyer est introuvable — AUCUN événement émis', async () => {
    const { db, insertValues } = fakeDbTransaction({ lignesUpdate: [] });
    const service = new FoyerService(db);

    await expect(
      service.mettreAJour(FOYER_ID, DTO_FOYER),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Le 404 est détecté AVANT l'insert outbox : pas d'événement fantôme.
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.obtenir / lister (tranche dérivée à la lecture)', () => {
  it('dérive la tranche 1 d’un RFR < 20 000 €', async () => {
    const db = fakeDbLecture([ligneFoyer({ rfrCentimes: 1500000 })]);
    const service = new FoyerService(db);

    const vue = await service.obtenir(FOYER_ID);
    expect(vue).toMatchObject({ rfrEuros: 15000, tranche: 1 });
  });

  it('BVA : un RFR exactement au seuil de 20 000 € tombe en tranche 2', async () => {
    const db = fakeDbLecture([ligneFoyer({ rfrCentimes: 2000000 })]);
    const service = new FoyerService(db);

    const vue = await service.obtenir(FOYER_ID);
    expect(vue.tranche).toBe(2);
  });

  it('lève NotFoundException si le foyer est introuvable', async () => {
    const db = fakeDbLecture([]);
    const service = new FoyerService(db);
    await expect(service.obtenir(FOYER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lister projette chaque ligne en vue (euros dérivés des centimes)', async () => {
    const autre = ligneFoyer({
      id: '33333333-3333-4333-8333-333333333333',
      rfrCentimes: 1000000,
    });
    const db = fakeDbLecture([ligneFoyer(), autre]);
    const service = new FoyerService(db);

    const vues = await service.lister();
    expect(vues).toHaveLength(2);
    expect(vues[0]).toMatchObject({ id: FOYER_ID, tranche: 3 });
    expect(vues[1]).toMatchObject({ rfrEuros: 10000, tranche: 1 });
  });
});

describe('FoyerService.ajouterEnfant (validation domaine + outbox)', () => {
  it('insère l’enfant + l’outbox EnfantAjoute dans la même transaction (prénom normalisé)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction({
      foyerPresent: true,
    });
    const service = new FoyerService(db);

    const vue = await service.ajouterEnfant(FOYER_ID, {
      prenom: '  Mia ',
      dateNaissance: '2024-03-15',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    // L'enfant : prénom passé par le domaine (trim).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        foyerId: FOYER_ID,
        prenom: 'Mia',
        dateNaissance: '2024-03-15',
      }),
    );
    // L'événement : même transaction, identité complète.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ENFANT_AJOUTE_TYPE,
        payload: expect.objectContaining({
          foyerId: FOYER_ID,
          prenom: 'Mia',
          dateNaissance: '2024-03-15',
        }),
      }),
    );
    expect(vue).toMatchObject({ foyerId: FOYER_ID, prenom: 'Mia' });
  });

  it('lève NotFoundException si le foyer est introuvable — ni enfant ni événement insérés', async () => {
    const { db, insertValues } = fakeDbTransaction({ foyerPresent: false });
    const service = new FoyerService(db);

    await expect(
      service.ajouterEnfant(FOYER_ID, {
        prenom: 'Mia',
        dateNaissance: '2024-03-15',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('un prénom vide est refusé par le domaine AVANT toute transaction', async () => {
    const { db, transaction } = fakeDbTransaction({ foyerPresent: true });
    const service = new FoyerService(db);

    await expect(
      service.ajouterEnfant(FOYER_ID, {
        prenom: '   ',
        dateNaissance: '2024-03-15',
      }),
    ).rejects.toThrow('prénom');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('FoyerService.listerEnfants', () => {
  it('projette les lignes en EnfantVue', async () => {
    const db = fakeDbLecture([
      {
        id: '44444444-4444-4444-8444-444444444444',
        foyerId: FOYER_ID,
        prenom: 'Mia',
        dateNaissance: '2024-03-15',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    const service = new FoyerService(db);

    const vues = await service.listerEnfants(FOYER_ID);
    expect(vues).toEqual([
      {
        id: '44444444-4444-4444-8444-444444444444',
        foyerId: FOYER_ID,
        prenom: 'Mia',
        dateNaissance: '2024-03-15',
      },
    ]);
  });
});

// --- Parents ---------------------------------------------------------------

const PARENT_ID = '55555555-5555-4555-8555-555555555555';

function ligneParent(overrides: Partial<ParentRow> = {}): ParentRow {
  return {
    id: PARENT_ID,
    foyerId: FOYER_ID,
    prenom: 'Alex',
    nom: 'Martin',
    email: 'parent@example.com',
    principal: false,
    ordre: 0,
    actif: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Faux `db` transactionnel pour les écritures de parent. Le `select` interne
 * (présence du foyer) répond `foyerPresent` ; `insert(parent).returning()` renvoie
 * la ligne reflétant les valeurs insérées (ou rejette `erreurInsert` pour simuler
 * une violation d'unicité 23505) ; `update().set().where().returning()` renvoie
 * `lignesUpdate` (vide ⇒ parent introuvable). `updateSet` espionne le `set`.
 */
function fakeDbParentTx(
  options: {
    foyerPresent?: boolean;
    lignesUpdate?: ParentRow[];
    erreurInsert?: { code: string; constraint_name?: string };
  } = {},
): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn((valeurs: Record<string, unknown>) => {
    const estParent = typeof valeurs['email'] === 'string';
    const erreur =
      options.erreurInsert && estParent
        ? Object.assign(new Error('violation unicité'), options.erreurInsert)
        : undefined;
    return Object.assign(Promise.resolve(), {
      returning: () =>
        erreur
          ? Promise.reject(erreur)
          : Promise.resolve([ligneParent(valeurs as Partial<ParentRow>)]),
    });
  });
  const updateSet = vi.fn(() => ({
    where: () => ({
      returning: () => Promise.resolve(options.lignesUpdate ?? []),
    }),
  }));
  const foyers = options.foyerPresent ? [{ id: FOYER_ID }] : [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(foyers) }) }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, updateSet };
}

/** Faux `db` pour les lectures parent (`select` ou `selectDistinct`). */
function fakeDbParentLecture(
  cle: 'select' | 'selectDistinct',
  ...reponses: unknown[][]
): Database {
  let i = 0;
  const builder = vi.fn(() => {
    const lignes = reponses[i++] ?? [];
    const chaine: Record<string, unknown> = {
      from: vi.fn(() => chaine),
      where: vi.fn(() => Object.assign(Promise.resolve(lignes), chaine)),
      orderBy: vi.fn(() => Promise.resolve(lignes)),
    };
    return chaine;
  });
  return { [cle]: builder } as unknown as Database;
}

describe('FoyerService.ajouterParent (validation foyer + outbox)', () => {
  it('insère le parent + l’outbox ParentAjoute dans la même transaction', async () => {
    const { db, transaction, insertValues } = fakeDbParentTx({
      foyerPresent: true,
    });
    const service = new FoyerService(db);

    const vue = await service.ajouterParent(FOYER_ID, {
      email: 'parent@example.com',
      prenom: 'Alex',
      principal: true,
      ordre: 0,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        foyerId: FOYER_ID,
        email: 'parent@example.com',
        prenom: 'Alex',
        principal: true,
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PARENT_AJOUTE_TYPE,
        payload: expect.objectContaining({
          foyerId: FOYER_ID,
          parentId: vue.id,
          email: 'parent@example.com',
          principal: true,
          actif: true,
        }),
      }),
    );
    expect(vue).toMatchObject({ email: 'parent@example.com', actif: true });
  });

  it('lève NotFoundException si le foyer est introuvable — ni parent ni événement', async () => {
    const { db, insertValues } = fakeDbParentTx({ foyerPresent: false });
    const service = new FoyerService(db);

    await expect(
      service.ajouterParent(FOYER_ID, {
        email: 'parent@example.com',
        principal: false,
        ordre: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('traduit une violation d’e-mail unique en 409 (adresse déjà utilisée)', async () => {
    const { db } = fakeDbParentTx({
      foyerPresent: true,
      erreurInsert: {
        code: '23505',
        constraint_name: 'parent_email_unique_idx',
      },
    });
    const service = new FoyerService(db);

    await expect(
      service.ajouterParent(FOYER_ID, {
        email: 'parent@example.com',
        principal: false,
        ordre: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('traduit une violation du principal unique en 409 (message dédié)', async () => {
    const { db } = fakeDbParentTx({
      foyerPresent: true,
      erreurInsert: {
        code: '23505',
        constraint_name: 'parent_principal_unique_idx',
      },
    });
    const service = new FoyerService(db);

    await expect(
      service.ajouterParent(FOYER_ID, {
        email: 'parent@example.com',
        principal: true,
        ordre: 0,
      }),
    ).rejects.toThrow('un parent principal existe déjà pour ce foyer');
  });
});

describe('FoyerService.modifierParent', () => {
  it('met à jour les champs fournis + ré-émet ParentModifie (même transaction)', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbParentTx({
      lignesUpdate: [ligneParent({ email: 'neuf@example.com' })],
    });
    const service = new FoyerService(db);

    const vue = await service.modifierParent(FOYER_ID, PARENT_ID, {
      email: 'neuf@example.com',
      actif: false,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'neuf@example.com', actif: false }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: PARENT_MODIFIE_TYPE }),
    );
    expect(vue.email).toBe('neuf@example.com');
  });

  it('ne touche que les champs fournis (corps vide ⇒ seul updatedAt)', async () => {
    const { db, updateSet } = fakeDbParentTx({
      lignesUpdate: [ligneParent()],
    });
    const service = new FoyerService(db);

    await service.modifierParent(FOYER_ID, PARENT_ID, {});
    const set = updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(set)).toEqual(['updatedAt']);
  });

  it('lève NotFoundException si le parent est introuvable — aucun événement', async () => {
    const { db, insertValues } = fakeDbParentTx({ lignesUpdate: [] });
    const service = new FoyerService(db);

    await expect(
      service.modifierParent(FOYER_ID, PARENT_ID, { actif: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.retirerParent (soft-delete + événement)', () => {
  it('passe actif=false + émet ParentRetire dans la même transaction', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbParentTx({
      lignesUpdate: [ligneParent({ actif: false })],
    });
    const service = new FoyerService(db);

    await service.retirerParent(FOYER_ID, PARENT_ID);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ actif: false }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PARENT_RETIRE_TYPE,
        payload: { foyerId: FOYER_ID, parentId: PARENT_ID },
      }),
    );
  });

  it('lève NotFoundException si le parent est introuvable — aucun événement', async () => {
    const { db, insertValues } = fakeDbParentTx({ lignesUpdate: [] });
    const service = new FoyerService(db);

    await expect(
      service.retirerParent(FOYER_ID, PARENT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.listerParents', () => {
  it('projette les parents actifs en ParentVue', async () => {
    const db = fakeDbParentLecture('select', [ligneParent()]);
    const service = new FoyerService(db);

    const vues = await service.listerParents(FOYER_ID);
    expect(vues).toEqual([
      {
        id: PARENT_ID,
        foyerId: FOYER_ID,
        prenom: 'Alex',
        nom: 'Martin',
        email: 'parent@example.com',
        principal: false,
        ordre: 0,
        actif: true,
      },
    ]);
  });
});

describe('FoyerService.foyersParEmail (résolution identité→foyers)', () => {
  it('renvoie les foyerId des parents actifs pour l’e-mail (insensible casse)', async () => {
    const db = fakeDbParentLecture('selectDistinct', [{ foyerId: FOYER_ID }]);
    const service = new FoyerService(db);

    const foyers = await service.foyersParEmail('  Parent@Example.com  ');
    expect(foyers).toEqual([FOYER_ID]);
  });

  it('renvoie [] pour un e-mail vide sans interroger la base', async () => {
    const db = {} as unknown as Database;
    const service = new FoyerService(db);
    expect(await service.foyersParEmail('   ')).toEqual([]);
  });
});
