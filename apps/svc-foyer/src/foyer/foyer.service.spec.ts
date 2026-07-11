import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
  ENFANT_RETIRE_TYPE,
  FOYER_MIS_A_JOUR_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
} from '@creche-planner/contracts-foyer';
import { FoyerService } from './foyer.service.js';
import type { Database } from '../database/database.types.js';
import type {
  FoyerRow,
  ParentRow,
  PreferenceNotificationRow,
} from '../database/schema.js';
import type { CreerFoyerDto, EcrireFoyerDto } from './foyer.dto.js';

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

/** DTO de création atomique minimal (scalaires seuls, dossier vide). */
const DTO_CREATION: CreerFoyerDto = { ...DTO_FOYER, enfants: [], parents: [] };

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

/**
 * Faux `db` transactionnel pour la création atomique où le **2ᵉ** insert de parent
 * échoue sur une violation d'unicité (23505). Les inserts précédents (foyer, enfant,
 * 1er parent, outbox) résolvent ; l'échec se propage hors de la transaction, où
 * `traduireUnicite` le convertit en 409. Sur une vraie base, tout est annulé.
 */
function fakeDbCreationRollback(): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
} {
  let parentInserts = 0;
  const insertValues = vi.fn((valeurs: Record<string, unknown>) => {
    if (typeof valeurs['email'] === 'string') {
      parentInserts += 1;
      if (parentInserts === 2) {
        const erreur = Object.assign(new Error('violation unicité'), {
          code: '23505',
          constraint_name: 'parent_email_par_foyer_actif_idx',
        });
        return Object.assign(Promise.resolve(), {
          returning: () => Promise.reject(erreur),
        });
      }
    }
    return Object.assign(Promise.resolve(), {
      returning: () => Promise.resolve([valeurs]),
    });
  });
  const tx = { insert: () => ({ values: insertValues }) };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues };
}

describe('FoyerService.creer (transactionnalité outbox)', () => {
  it('insère le foyer + l’outbox FoyerMisAJour dans UNE seule transaction (centimes, tranche dérivée)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    const dossier = await service.creer(DTO_CREATION);

    expect(transaction).toHaveBeenCalledTimes(1);
    // L'état : montants convertis en centimes entiers (fidèle à Money).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: dossier.foyer.id,
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
          foyerId: dossier.foyer.id,
          ressourcesMensuellesCentimes: 350000,
          rfrCentimes: 7270500,
          nbEnfantsACharge: 2,
          nbParts: 3,
          tranche: 3,
        },
      }),
    );
    expect(dossier.foyer).toMatchObject({
      ressourcesMensuellesEuros: 3500,
      rfrEuros: 72705,
      tranche: 3,
    });
    // Dossier vide : ni enfant ni parent (aucun `createurEmail`).
    expect(dossier.enfants).toEqual([]);
    expect(dossier.parents).toEqual([]);
  });

  it('INVARIANT : un échec de l’insert outbox se propage (rollback) — pas de foyer sans événement', async () => {
    const { db, transaction } = fakeDbTransaction({ echecOutbox: true });
    const service = new FoyerService(db);

    // L'échec survient DANS l'unique transaction : sur une vraie base, l'insert
    // du foyer est annulé avec celui de l'outbox (atomicité, doc 06 §8.4).
    await expect(service.creer(DTO_CREATION)).rejects.toThrow(
      'outbox indisponible',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('une validation domaine en échec (nbParts ≤ 0) ne touche JAMAIS la base', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    await expect(
      service.creer({ ...DTO_CREATION, nbParts: 0 }),
    ).rejects.toThrow('nombre de parts invalide');
    expect(transaction).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.creer (dossier atomique : enfants + parents + créateur)', () => {
  it('insère foyer + enfants + parents et rattache le créateur en fin (ordre suivant)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    const dossier = await service.creer({
      ...DTO_CREATION,
      enfants: [{ prenom: '  Mia ', dateNaissance: '2024-03-15' }],
      parents: [{ email: 'saisi@example.com', principal: true, ordre: 0 }],
      createurEmail: 'createur@example.com',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    // Tous les événements dans la même transaction, dans l'ordre du dossier :
    // FoyerMisAJour, EnfantAjoute, puis 2×ParentAjoute (saisi + créateur).
    const typesOutbox = insertValues.mock.calls
      .map((c) => (c[0] as { type?: unknown }).type)
      .filter((t): t is string => typeof t === 'string');
    expect(typesOutbox).toEqual([
      FOYER_MIS_A_JOUR_TYPE,
      ENFANT_AJOUTE_TYPE,
      PARENT_AJOUTE_TYPE,
      PARENT_AJOUTE_TYPE,
    ]);
    expect(dossier.foyer.tranche).toBe(3);
    // Enfant : prénom normalisé par le domaine (trim).
    expect(dossier.enfants).toHaveLength(1);
    expect(dossier.enfants[0]?.prenom).toBe('Mia');
    // Le créateur est rattaché EN FIN, avec l'ordre suivant (max(0)+1 = 1).
    expect(dossier.parents.map((p) => p.email)).toEqual([
      'saisi@example.com',
      'createur@example.com',
    ]);
    expect(dossier.parents[1]?.ordre).toBe(1);
    expect(dossier.parents[1]?.principal).toBe(false);
  });

  it('ne duplique pas le créateur déjà saisi (comparaison insensible à la casse)', async () => {
    const { db, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    const dossier = await service.creer({
      ...DTO_CREATION,
      parents: [{ email: 'Createur@Example.com', principal: false, ordre: 0 }],
      createurEmail: 'createur@example.com',
    });

    expect(dossier.parents).toHaveLength(1);
    expect(dossier.parents[0]?.email).toBe('Createur@Example.com');
    const inserts = insertValues.mock.calls.filter(
      (c) => typeof (c[0] as { email?: unknown }).email === 'string',
    );
    expect(inserts).toHaveLength(1);
  });

  it('sans createurEmail (admin / mode hérité) : aucun parent auto-rattaché', async () => {
    const { db, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db);

    const dossier = await service.creer(DTO_CREATION);

    expect(dossier.parents).toEqual([]);
    const aParent = insertValues.mock.calls.some(
      (c) => typeof (c[0] as { email?: unknown }).email === 'string',
    );
    expect(aParent).toBe(false);
  });

  it('INVARIANT : e-mail du 2ᵉ parent dupliqué → 409 et rollback complet du dossier', async () => {
    const { db, transaction } = fakeDbCreationRollback();
    const service = new FoyerService(db);

    // L'échec (23505) survient DANS l'unique transaction : sur une vraie base,
    // le foyer, l'enfant et le 1er parent sont annulés avec lui (atomicité).
    await expect(
      service.creer({
        ...DTO_CREATION,
        enfants: [{ prenom: 'Mia', dateNaissance: '2024-03-15' }],
        parents: [
          { email: 'a@example.com', principal: false, ordre: 0 },
          { email: 'b@example.com', principal: false, ordre: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).toHaveBeenCalledTimes(1);
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

const ENFANT_ID = '44444444-4444-4444-8444-444444444444';

/** Ligne enfant de référence (le read model n'a pas d'`updatedAt`). */
function ligneEnfant(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: ENFANT_ID,
    foyerId: FOYER_ID,
    prenom: 'Mia',
    dateNaissance: '2024-03-15',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Faux `db` transactionnel pour `modifierEnfant`/`retirerEnfant` :
 * `update().set().where().returning()` (espionné via `updateSet`) et
 * `delete().where().returning()` renvoient `lignes` (vide ⇒ enfant introuvable) ;
 * `insertValues` espionne l'insert d'outbox.
 */
function fakeDbEnfantTx(options: { lignes?: Record<string, unknown>[] } = {}): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  deleteWhere: ReturnType<typeof vi.fn>;
} {
  const lignes = options.lignes ?? [];
  const insertValues = vi.fn(() => Promise.resolve());
  const updateSet = vi.fn(() => ({
    where: () => ({ returning: () => Promise.resolve(lignes) }),
  }));
  const deleteWhere = vi.fn(() => ({
    returning: () => Promise.resolve(lignes),
  }));
  const tx = {
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
    delete: () => ({ where: deleteWhere }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, updateSet, deleteWhere };
}

describe('FoyerService.modifierEnfant', () => {
  it('met à jour l’enfant (prénom normalisé) + ré-émet EnfantModifie (même transaction)', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbEnfantTx({
      lignes: [ligneEnfant({ prenom: 'Zoé', dateNaissance: '2023-03-12' })],
    });
    const service = new FoyerService(db);

    const vue = await service.modifierEnfant(FOYER_ID, ENFANT_ID, {
      prenom: '  Zoé ',
      dateNaissance: '2023-03-12',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    // Le prénom est passé par le domaine (trim) avant écriture.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ prenom: 'Zoé', dateNaissance: '2023-03-12' }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ENFANT_MODIFIE_TYPE,
        payload: expect.objectContaining({
          foyerId: FOYER_ID,
          enfantId: ENFANT_ID,
          prenom: 'Zoé',
          dateNaissance: '2023-03-12',
        }),
      }),
    );
    expect(vue).toMatchObject({ id: ENFANT_ID, prenom: 'Zoé' });
  });

  it('lève NotFoundException si l’enfant est introuvable — aucun événement émis', async () => {
    const { db, insertValues } = fakeDbEnfantTx({ lignes: [] });
    const service = new FoyerService(db);

    await expect(
      service.modifierEnfant(FOYER_ID, ENFANT_ID, {
        prenom: 'Zoé',
        dateNaissance: '2023-03-12',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('un prénom vide est refusé par le domaine AVANT toute transaction', async () => {
    const { db, transaction } = fakeDbEnfantTx({ lignes: [ligneEnfant()] });
    const service = new FoyerService(db);

    await expect(
      service.modifierEnfant(FOYER_ID, ENFANT_ID, {
        prenom: '   ',
        dateNaissance: '2023-03-12',
      }),
    ).rejects.toThrow('prénom');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('FoyerService.retirerEnfant (hard delete + événement)', () => {
  it('supprime l’enfant + émet EnfantRetire dans la même transaction', async () => {
    const { db, transaction, deleteWhere, insertValues } = fakeDbEnfantTx({
      lignes: [ligneEnfant()],
    });
    const service = new FoyerService(db);

    await service.retirerEnfant(FOYER_ID, ENFANT_ID);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ENFANT_RETIRE_TYPE,
        payload: { foyerId: FOYER_ID, enfantId: ENFANT_ID },
      }),
    );
  });

  it('lève NotFoundException si l’enfant est introuvable — aucun événement émis', async () => {
    const { db, insertValues } = fakeDbEnfantTx({ lignes: [] });
    const service = new FoyerService(db);

    await expect(
      service.retirerEnfant(FOYER_ID, ENFANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
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
 * Faux `db` transactionnel pour les écritures de parent. Le `select` interne sert
 * deux usages : sa valeur **awaitée** = présence du foyer (`foyerPresent`,
 * `ajouterParent`) ; son `.for('update')` = **parents actifs** verrouillés par la
 * garde « dernier parent » (`parentsActifs`, `retirerParent`/`modifierParent`).
 * `insert(parent).returning()` renvoie la ligne reflétant les valeurs insérées (ou
 * rejette `erreurInsert` pour simuler une violation d'unicité 23505) ;
 * `update().set().where().returning()` renvoie `lignesUpdate` (vide ⇒ parent
 * introuvable). `updateSet` espionne le `set` ; `forUpdate` espionne le verrou.
 */
function fakeDbParentTx(
  options: {
    foyerPresent?: boolean;
    lignesUpdate?: ParentRow[];
    erreurInsert?: { code: string; constraint_name?: string };
    parentsActifs?: { id: string }[];
    /** Ligne(s) inactive(s) même e-mail renvoyée(s) par le 2ᵉ select d'`ajouterParent`. */
    parentInactif?: ParentRow[];
  } = {},
): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  forUpdate: ReturnType<typeof vi.fn>;
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
  const actifs = options.parentsActifs ?? [];
  const forUpdate = vi.fn((_strength?: string) => Promise.resolve(actifs));
  // `where()` est à la fois **awaitable** ET porteuse de `.for('update')`.
  // Séquence des `select` : dans `ajouterParent`, #0 = présence du foyer, #1 =
  // ligne inactive à réactiver (même e-mail) ; dans `retirerParent`/`modifierParent`
  // le select unique sert la garde via `.for('update')` (valeur awaitée inutilisée).
  let selectIndex = 0;
  const selectWhere = () => {
    const valeur = selectIndex++ === 0 ? foyers : (options.parentInactif ?? []);
    return Object.assign(Promise.resolve(valeur), { for: forUpdate });
  };
  const tx = {
    select: () => ({ from: () => ({ where: selectWhere }) }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, updateSet, forUpdate };
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

  it('traduit une violation d’e-mail unique en 409 structuré (code EMAIL_DEJA_UTILISE)', async () => {
    const { db } = fakeDbParentTx({
      foyerPresent: true,
      erreurInsert: {
        code: '23505',
        constraint_name: 'parent_email_par_foyer_actif_idx',
      },
    });
    const service = new FoyerService(db);

    const err = await service
      .ajouterParent(FOYER_ID, {
        email: 'parent@example.com',
        principal: false,
        ordre: 0,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'EMAIL_DEJA_UTILISE',
      message: 'adresse e-mail déjà utilisée dans ce foyer',
    });
  });

  it('réactive une ligne inactive au lieu d’insérer (même e-mail, même foyer)', async () => {
    // Un parent retiré (soft-delete) porte déjà ce lower(email) : le ré-ajout
    // RÉACTIVE la ligne existante (update actif=true) plutôt que d'insérer.
    const inactif = ligneParent({ actif: false, prenom: 'Ancien' });
    const { db, updateSet, insertValues } = fakeDbParentTx({
      foyerPresent: true,
      parentInactif: [inactif],
      lignesUpdate: [
        ligneParent({ actif: true, prenom: 'Alex', principal: true }),
      ],
    });
    const service = new FoyerService(db);

    const vue = await service.ajouterParent(FOYER_ID, {
      email: 'PARENT@example.com', // casse différente : match insensible à la casse
      prenom: 'Alex',
      principal: true,
      ordre: 0,
    });

    // Réactivation via UPDATE (actif=true + valeurs de la saisie), pas d'insert parent.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        actif: true,
        prenom: 'Alex',
        principal: true,
      }),
    );
    // Le seul insert restant est l'événement outbox ParentAjoute (état complet).
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PARENT_AJOUTE_TYPE,
        payload: expect.objectContaining({ actif: true, principal: true }),
      }),
    );
    expect(vue).toMatchObject({ actif: true, principal: true });
  });

  it('traduit une violation du principal unique en 409 structuré (code PARENT_PRINCIPAL_EXISTANT)', async () => {
    const { db } = fakeDbParentTx({
      foyerPresent: true,
      erreurInsert: {
        code: '23505',
        constraint_name: 'parent_principal_unique_idx',
      },
    });
    const service = new FoyerService(db);

    const err = await service
      .ajouterParent(FOYER_ID, {
        email: 'parent@example.com',
        principal: true,
        ordre: 0,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'PARENT_PRINCIPAL_EXISTANT',
      message: 'un parent principal existe déjà pour ce foyer',
    });
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

  it('GARDE : modifierParent(actif:false) sur le DERNIER parent actif → 409 DERNIER_PARENT_ACTIF (aucune écriture)', async () => {
    const { db, updateSet, insertValues, forUpdate } = fakeDbParentTx({
      parentsActifs: [{ id: PARENT_ID }],
    });
    const service = new FoyerService(db);

    const err = await service
      .modifierParent(FOYER_ID, PARENT_ID, { actif: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'DERNIER_PARENT_ACTIF',
    });
    // La garde bloque AVANT l'update/outbox : aucun état ni événement modifié.
    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('GARDE : modifierParent(actif:false) avec un AUTRE parent actif → autorisé', async () => {
    const { db, updateSet } = fakeDbParentTx({
      parentsActifs: [{ id: PARENT_ID }, { id: 'autre-parent' }],
      lignesUpdate: [ligneParent({ actif: false })],
    });
    const service = new FoyerService(db);

    await service.modifierParent(FOYER_ID, PARENT_ID, { actif: false });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ actif: false }),
    );
  });

  it('GARDE : modifierParent SANS actif:false ne consulte pas les parents actifs', async () => {
    const { db, forUpdate } = fakeDbParentTx({
      lignesUpdate: [ligneParent({ email: 'neuf@example.com' })],
    });
    const service = new FoyerService(db);

    await service.modifierParent(FOYER_ID, PARENT_ID, {
      email: 'neuf@example.com',
    });
    expect(forUpdate).not.toHaveBeenCalled();
  });
});

describe('FoyerService.retirerParent (soft-delete + événement)', () => {
  it('passe actif=false + émet ParentRetire dans la même transaction (≥ 2 parents actifs)', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbParentTx({
      parentsActifs: [{ id: PARENT_ID }, { id: 'autre-parent' }],
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
    const { db, insertValues } = fakeDbParentTx({
      parentsActifs: [{ id: 'autre-parent' }],
      lignesUpdate: [],
    });
    const service = new FoyerService(db);

    await expect(
      service.retirerParent(FOYER_ID, PARENT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('GARDE : retirer le DERNIER parent actif → 409 DERNIER_PARENT_ACTIF, aucune écriture', async () => {
    const { db, transaction, updateSet, insertValues, forUpdate } =
      fakeDbParentTx({
        parentsActifs: [{ id: PARENT_ID }],
        lignesUpdate: [ligneParent({ actif: false })],
      });
    const service = new FoyerService(db);

    const err = await service
      .retirerParent(FOYER_ID, PARENT_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'DERNIER_PARENT_ACTIF',
    });
    // Verrou pris DANS la transaction (pas de pré-lecture) puis blocage : aucun
    // état ni événement modifié (rollback sur une vraie base).
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(updateSet).not.toHaveBeenCalled();
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

// --- Préférences de notification (PR1) -------------------------------------

/** Ligne de préférence stockée de référence. */
function lignePref(
  overrides: Partial<PreferenceNotificationRow> = {},
): PreferenceNotificationRow {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    parentId: PARENT_ID,
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'EMAIL',
    actif: true,
    consentementAt: null,
    desabonneAt: null,
    sourceDernier: 'ECRAN',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Faux `db` **transactionnel** pour `majPreferences`. Le 1er `select` interne
 * répond la présence du parent (`parent` défini ⇒ trouvé) ; le 2nd renvoie
 * `readback` (l'état relu après upsert, qui pilote invariant + événement).
 * `insertValues` espionne tout `insert(...).values(...)` ; les inserts de
 * préférence exposent `.onConflictDoUpdate()` (upsert idempotent sur la clé
 * unique) dont les arguments sont capturés dans `onConflictArgs`.
 */
function fakeDbPreferencesTx(options: {
  parent?: Pick<ParentRow, 'id' | 'foyerId'>;
  readback?: PreferenceNotificationRow[];
}): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  onConflictArgs: unknown[];
} {
  const onConflictArgs: unknown[] = [];
  const insertValues = vi.fn(() =>
    Object.assign(Promise.resolve(), {
      onConflictDoUpdate: (arg: unknown) => {
        onConflictArgs.push(arg);
        return Promise.resolve();
      },
    }),
  );
  const parents = options.parent ? [options.parent] : [];
  const readback = options.readback ?? [];
  let selectCount = 0;
  const select = vi.fn(() => {
    const lignes = selectCount++ === 0 ? parents : readback;
    return { from: () => ({ where: () => Promise.resolve(lignes) }) };
  });
  const tx = { select, insert: () => ({ values: insertValues }) };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, onConflictArgs };
}

/** Faux `db` pour les lectures de `lirePreferences` (parent puis préférences). */
function fakeDbPreferencesLecture(options: {
  parent?: Pick<ParentRow, 'id' | 'foyerId'>;
  rows?: PreferenceNotificationRow[];
}): Database {
  let count = 0;
  const select = vi.fn(() => {
    const lignes =
      count++ === 0
        ? options.parent
          ? [options.parent]
          : []
        : (options.rows ?? []);
    return { from: () => ({ where: () => Promise.resolve(lignes) }) };
  });
  return { select } as unknown as Database;
}

describe('FoyerService.lirePreferences (défauts fusionnés)', () => {
  it('renvoie la matrice par défaut (VALIDATION_HEBDO e-mail + in-app actifs) sans ligne stockée', async () => {
    const db = fakeDbPreferencesLecture({
      parent: { id: PARENT_ID, foyerId: FOYER_ID },
      rows: [],
    });
    const service = new FoyerService(db);

    const prefs = await service.lirePreferences(FOYER_ID, PARENT_ID);
    expect(prefs).toEqual([
      {
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'EMAIL',
        actif: true,
        consentementAt: null,
        desabonneAt: null,
      },
      {
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'IN_APP',
        actif: true,
        consentementAt: null,
        desabonneAt: null,
      },
    ]);
  });

  it('surcharge le défaut par le choix explicite stocké (e-mail coupé, désabo tracé)', async () => {
    const db = fakeDbPreferencesLecture({
      parent: { id: PARENT_ID, foyerId: FOYER_ID },
      rows: [
        lignePref({
          canal: 'EMAIL',
          actif: false,
          desabonneAt: new Date('2026-07-01T09:00:00Z'),
        }),
      ],
    });
    const service = new FoyerService(db);

    const prefs = await service.lirePreferences(FOYER_ID, PARENT_ID);
    expect(prefs[0]).toMatchObject({
      canal: 'EMAIL',
      actif: false,
      desabonneAt: '2026-07-01T09:00:00.000Z',
    });
    // L'in-app non stocké retombe sur le défaut actif.
    expect(prefs[1]).toMatchObject({ canal: 'IN_APP', actif: true });
  });

  it('lève NotFoundException si le parent n’appartient pas au foyer', async () => {
    const db = fakeDbPreferencesLecture({ rows: [] });
    const service = new FoyerService(db);
    await expect(
      service.lirePreferences(FOYER_ID, PARENT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FoyerService.majPreferences (upsert + outbox + invariant)', () => {
  it('upsert les préférences + émet PreferencesNotifModifiees (état complet) dans la même transaction', async () => {
    const { db, transaction, insertValues, onConflictArgs } =
      fakeDbPreferencesTx({
        parent: { id: PARENT_ID, foyerId: FOYER_ID },
        readback: [
          lignePref({ canal: 'EMAIL', actif: false }),
          lignePref({
            id: '77777777-7777-4777-8777-777777777777',
            canal: 'IN_APP',
            actif: true,
          }),
        ],
      });
    const service = new FoyerService(db);

    const prefs = await service.majPreferences(FOYER_ID, PARENT_ID, {
      preferences: [
        { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: false },
        { typeNotification: 'VALIDATION_HEBDO', canal: 'IN_APP', actif: true },
      ],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    // Upsert idempotent : un onConflictDoUpdate par préférence, ciblant la clé
    // unique (parent, type, canal).
    expect(onConflictArgs).toHaveLength(2);
    expect(onConflictArgs[0]).toMatchObject({
      target: expect.arrayContaining([expect.anything()]),
    });
    // L'événement : même transaction, état complet, tranche e-mail coupée.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PREFERENCES_NOTIF_MODIFIEES_TYPE,
        payload: expect.objectContaining({
          foyerId: FOYER_ID,
          parentId: PARENT_ID,
          preferences: [
            {
              typeNotification: 'VALIDATION_HEBDO',
              canal: 'EMAIL',
              actif: false,
            },
            {
              typeNotification: 'VALIDATION_HEBDO',
              canal: 'IN_APP',
              actif: true,
            },
          ],
        }),
      }),
    );
    expect(prefs).toEqual([
      {
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'EMAIL',
        actif: false,
        consentementAt: null,
        desabonneAt: null,
      },
      {
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'IN_APP',
        actif: true,
        consentementAt: null,
        desabonneAt: null,
      },
    ]);
  });

  it('INVARIANT ≥1 canal : refuse (400) de couper tous les canaux d’un type de service — AUCUN événement émis', async () => {
    const { db, insertValues } = fakeDbPreferencesTx({
      parent: { id: PARENT_ID, foyerId: FOYER_ID },
      readback: [
        lignePref({ canal: 'EMAIL', actif: false }),
        lignePref({
          id: '77777777-7777-4777-8777-777777777777',
          canal: 'IN_APP',
          actif: false,
        }),
      ],
    });
    const service = new FoyerService(db);

    await expect(
      service.majPreferences(FOYER_ID, PARENT_ID, {
        preferences: [
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'EMAIL',
            actif: false,
          },
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'IN_APP',
            actif: false,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // L'invariant est contrôlé AVANT l'insert outbox : pas d'événement fantôme
    // (et sur une vraie base la transaction est annulée avec les upserts).
    const aEmisEvenement = insertValues.mock.calls.some(
      (c) =>
        (c[0] as { type?: string }).type === PREFERENCES_NOTIF_MODIFIEES_TYPE,
    );
    expect(aEmisEvenement).toBe(false);
  });

  it('lève NotFoundException si le parent n’appartient pas au foyer — aucun upsert ni événement', async () => {
    const { db, insertValues } = fakeDbPreferencesTx({ readback: [] });
    const service = new FoyerService(db);

    await expect(
      service.majPreferences(FOYER_ID, PARENT_ID, {
        preferences: [
          { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
