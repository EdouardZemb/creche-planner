import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
  ENFANT_RETIRE_TYPE,
  FOYER_MIS_A_JOUR_V3_TYPE,
  FOYER_SUPPRIME_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
  type FoyerMisAJourPayloadV3,
} from '@creche-planner/contracts-foyer';
import type { Acteur } from '@creche-planner/nest-commons';
import { FoyerService } from './foyer.service.js';
import { ACTIONS_AUDIT } from '../audit/journal-audit.actions.js';
import { JournalAuditService } from '../audit/journal-audit.service.js';
import type { Database } from '../database/database.types.js';
import {
  baremeTranches,
  foyer as foyerTable,
  foyerVersion,
  type BaremeTranchesRow,
  type FoyerRow,
  type FoyerVersionRow,
  type ParentRow,
  type PreferenceNotificationRow,
} from '../database/schema.js';
import type { CreerFoyerDto, EcrireFoyerDto } from './foyer.dto.js';

/** Barème de tranches projeté (mêmes seuils métier), applicable depuis 2020. */
function ligneBaremeTranches(): BaremeTranchesRow {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000000',
    valideDu: '2020-01-01',
    valideAu: null,
    seuils: [
      { niveau: 1, rfrMaxCentimes: 1999999 },
      { niveau: 2, rfrMaxCentimes: 5000000 },
      { niveau: 3, rfrMaxCentimes: null },
    ],
    eventId: null,
    occurredAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Ligne `foyer_version` de référence (RFR 72 705 € ⇒ tranche 3). */
function ligneFoyerVersion(
  overrides: Partial<FoyerVersionRow> = {},
): FoyerVersionRow {
  return {
    id: 'bbbbbbbb-0000-4000-8000-000000000000',
    foyerId: FOYER_ID,
    dateEffet: '2026-01-01',
    // Version en vigueur : aucune suivante ne la clôt (`AM-55`).
    dateFin: null,
    ressourcesMensuellesCentimes: 350000,
    rfrCentimes: 7270500,
    nbEnfantsACharge: 2,
    nbParts: 3,
    saisiLe: new Date('2026-01-01T00:00:00Z'),
    motif: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Tests unitaires du `FoyerService` SANS infra (Postgres mocké), AQ-08. Même motif
 * que `planification.service.spec.ts` : un faux `db` aux chaînes Drizzle
 * espionnables. Les cas à risque ciblés par l'audit (doc 27) : **transactionnalité
 * outbox** (événement inséré dans la même transaction que l'état), 404, validation
 * domaine avant toute écriture. La projection SQL réelle reste couverte par la
 * vérification Pact provider (base réelle en CI).
 */

const FOYER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Acteur de référence des mutations (lot 6, `AM-45`) : un parent identifié, tel
 * que le décorateur `@ActeurCourant` le tire de l'assertion vérifiée. Les tests
 * qui n'ont rien à dire de la piste d'audit le passent sans le regarder ; ceux qui
 * la vérifient assertent la ligne `journal_audit` produite.
 */
const ACTEUR: Acteur = { type: 'parent', email: 'claire@example.test' };

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
    echecOutbox?: boolean;
    /** Barème de tranches projeté (défaut : seuils métier depuis 2020). */
    baremes?: BaremeTranchesRow[];
    /** Versions pré-existantes du foyer (défaut : aucune → accumulées par insert). */
    versions?: FoyerVersionRow[];
  } = {},
): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  versionsAccum: FoyerVersionRow[];
} {
  const baremes = options.baremes ?? [ligneBaremeTranches()];
  const foyerPresent = options.foyerPresent ?? true;
  const foyers = foyerPresent ? [ligneFoyer()] : [];
  // Le fake **accumule** les versions insérées : la vérif d'existence à la date
  // d'effet (avant insert) voit l'accumulateur vide, la ré-émission (après insert)
  // voit la version fraîche — sans filtrer par `where` (le fake ne le sait pas).
  const versionsAccum: FoyerVersionRow[] = [...(options.versions ?? [])];
  const insertValues = vi.fn((valeurs: Record<string, unknown>) => {
    if (
      typeof valeurs['dateEffet'] === 'string' &&
      typeof valeurs['rfrCentimes'] === 'number'
    ) {
      // Mime `onConflictDoUpdate` (clé `foyer_id,date_effet`) : remplace si la date
      // d'effet existe déjà, sinon ajoute — pas de doublon de date d'effet.
      const row = ligneFoyerVersion(valeurs);
      const idx = versionsAccum.findIndex((v) => v.dateEffet === row.dateEffet);
      if (idx >= 0) {
        versionsAccum[idx] = row;
      } else {
        versionsAccum.push(row);
      }
    }
    const promesse =
      options.echecOutbox && typeof valeurs['type'] === 'string'
        ? Promise.reject(new Error('outbox indisponible'))
        : Promise.resolve();
    return Object.assign(promesse, {
      returning: () => Promise.resolve([valeurs]),
      onConflictDoUpdate: () => Promise.resolve(),
    });
  });
  const updateSet = vi.fn(() => ({
    where: () =>
      Object.assign(Promise.resolve([]), {
        returning: () => Promise.resolve([]),
      }),
  }));
  const rowsPour = (table: unknown): unknown[] => {
    if (table === baremeTranches) return baremes;
    if (table === foyerVersion) return versionsAccum;
    if (table === foyerTable) return foyers;
    return [];
  };
  const from = (table: unknown) => {
    const rows = rowsPour(table);
    // `.where(...)` est awaitable ET expose `.for('update')` : le verrou de
    // l'historique (AM-55) est posé sur la ligne foyer, le double doit donc le
    // porter — sans quoi il prouverait une chaîne d'appels qui n'existe plus.
    const resultat = Object.assign(Promise.resolve(rows), {
      for: () => Promise.resolve(rows),
    });
    return Object.assign(Promise.resolve(rows), {
      where: () => resultat,
    });
  };
  const tx = {
    select: () => ({ from }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, updateSet, versionsAccum };
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
    const chaine: Record<string, unknown> = {};
    // `from()` doit être **awaitable** (lectures table entière : barème, sans `where`).
    const maillon = () => Object.assign(Promise.resolve(lignes), chaine);
    chaine['where'] = vi.fn(maillon);
    chaine['orderBy'] = vi.fn(maillon);
    chaine['from'] = vi.fn(maillon);
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
  const baremes = [ligneBaremeTranches()];
  const versionsAccum: FoyerVersionRow[] = [];
  let parentInserts = 0;
  const insertValues = vi.fn((valeurs: Record<string, unknown>) => {
    if (
      typeof valeurs['dateEffet'] === 'string' &&
      typeof valeurs['rfrCentimes'] === 'number'
    ) {
      versionsAccum.push(ligneFoyerVersion(valeurs));
    }
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
  const from = (table: unknown) => {
    const rows =
      table === baremeTranches
        ? baremes
        : table === foyerVersion
          ? versionsAccum
          : [];
    // `.where(...)` est awaitable ET expose `.for('update')` : le verrou de
    // l'historique (AM-55) est posé sur la ligne foyer, le double doit donc le
    // porter — sans quoi il prouverait une chaîne d'appels qui n'existe plus.
    const resultat = Object.assign(Promise.resolve(rows), {
      for: () => Promise.resolve(rows),
    });
    return Object.assign(Promise.resolve(rows), {
      where: () => resultat,
    });
  };
  const tx = {
    select: () => ({ from }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues };
}

describe('FoyerService.creer (transactionnalité outbox)', () => {
  it('insère le foyer + la version initiale + l’outbox FoyerMisAJour.v3 dans UNE transaction (centimes, tranche dérivée)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db, new JournalAuditService());

    const dossier = await service.creer(DTO_CREATION, ACTEUR);

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
    // La version initiale des ressources (date d'effet = aujourd'hui par défaut).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        foyerId: dossier.foyer.id,
        dateEffet: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        rfrCentimes: 7270500,
      }),
    );
    // L'événement v3 : même transaction, tranche dérivée du barème, versionId + dateEffet.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FOYER_MIS_A_JOUR_V3_TYPE,
        payload: expect.objectContaining({
          foyerId: dossier.foyer.id,
          ressourcesMensuellesCentimes: 350000,
          rfrCentimes: 7270500,
          nbEnfantsACharge: 2,
          nbParts: 3,
          tranche: 3,
          versionId: expect.any(String),
          dateEffet: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
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
    const service = new FoyerService(db, new JournalAuditService());

    // L'échec survient DANS l'unique transaction : sur une vraie base, l'insert
    // du foyer est annulé avec celui de l'outbox (atomicité, doc 06 §8.4).
    await expect(service.creer(DTO_CREATION, ACTEUR)).rejects.toThrow(
      'outbox indisponible',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('une validation domaine en échec (nbParts ≤ 0) ne touche JAMAIS la base', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.creer({ ...DTO_CREATION, nbParts: 0 }, ACTEUR),
    ).rejects.toThrow('nombre de parts invalide');
    expect(transaction).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.creer (dossier atomique : enfants + parents + créateur)', () => {
  it('insère foyer + enfants + parents et rattache le créateur en fin (ordre suivant)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db, new JournalAuditService());

    const dossier = await service.creer(
      {
        ...DTO_CREATION,
        enfants: [{ prenom: '  Mia ', dateNaissance: '2024-03-15' }],
        parents: [{ email: 'saisi@example.com', principal: true, ordre: 0 }],
        createurEmail: 'createur@example.com',
      },
      ACTEUR,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    // Tous les événements dans la même transaction, dans l'ordre du dossier :
    // FoyerMisAJour, EnfantAjoute, puis 2×ParentAjoute (saisi + créateur).
    const typesOutbox = insertValues.mock.calls
      .map((c) => (c[0] as { type?: unknown }).type)
      .filter((t): t is string => typeof t === 'string');
    expect(typesOutbox).toEqual([
      FOYER_MIS_A_JOUR_V3_TYPE,
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
    const service = new FoyerService(db, new JournalAuditService());

    const dossier = await service.creer(
      {
        ...DTO_CREATION,
        parents: [
          { email: 'Createur@Example.com', principal: false, ordre: 0 },
        ],
        createurEmail: 'createur@example.com',
      },
      ACTEUR,
    );

    expect(dossier.parents).toHaveLength(1);
    expect(dossier.parents[0]?.email).toBe('Createur@Example.com');
    const inserts = insertValues.mock.calls.filter(
      (c) => typeof (c[0] as { email?: unknown }).email === 'string',
    );
    expect(inserts).toHaveLength(1);
  });

  it('sans createurEmail (admin / mode hérité) : aucun parent auto-rattaché', async () => {
    const { db, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db, new JournalAuditService());

    const dossier = await service.creer(DTO_CREATION, ACTEUR);

    expect(dossier.parents).toEqual([]);
    const aParent = insertValues.mock.calls.some(
      (c) => typeof (c[0] as { email?: unknown }).email === 'string',
    );
    expect(aParent).toBe(false);
  });

  it('INVARIANT : e-mail du 2ᵉ parent dupliqué → 409 et rollback complet du dossier', async () => {
    const { db, transaction } = fakeDbCreationRollback();
    const service = new FoyerService(db, new JournalAuditService());

    // L'échec (23505) survient DANS l'unique transaction : sur une vraie base,
    // le foyer, l'enfant et le 1er parent sont annulés avec lui (atomicité).
    await expect(
      service.creer(
        {
          ...DTO_CREATION,
          enfants: [{ prenom: 'Mia', dateNaissance: '2024-03-15' }],
          parents: [
            { email: 'a@example.com', principal: false, ordre: 0 },
            { email: 'b@example.com', principal: false, ordre: 1 },
          ],
        },
        ACTEUR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('FoyerService.mettreAJour (versions à date d’effet)', () => {
  it('crée une version + ré-émet FoyerMisAJour.v3 + rafraîchit la ligne foyer courante', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.mettreAJour(FOYER_ID, DTO_FOYER, ACTEUR);

    expect(transaction).toHaveBeenCalledTimes(1);
    // La version applicable aujourd'hui rafraîchit la ligne foyer courante.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ressourcesMensuellesCentimes: 350000,
        rfrCentimes: 7270500,
      }),
    );
    // Une nouvelle version de ressources est insérée à la date d'effet (aujourd'hui).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        foyerId: FOYER_ID,
        dateEffet: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        rfrCentimes: 7270500,
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FOYER_MIS_A_JOUR_V3_TYPE,
        payload: expect.objectContaining({ foyerId: FOYER_ID, tranche: 3 }),
      }),
    );
    expect(vue.id).toBe(FOYER_ID);
  });

  it('date d’effet future : la version est créée à cette date', async () => {
    const { db, insertValues } = fakeDbTransaction();
    const service = new FoyerService(db, new JournalAuditService());

    await service.mettreAJour(
      FOYER_ID,
      {
        ...DTO_FOYER,
        dateEffet: '2027-01-01',
      },
      ACTEUR,
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        dateEffet: '2027-01-01',
        rfrCentimes: 7270500,
      }),
    );
  });

  /**
   * **`AM-55` — la fin d'une version existe en base.** Elle était dérivée à la
   * lecture par chaque consommateur : « dernière version » et « version dont on
   * ignore la suite » étaient alors le même objet, et l'aval valorisait un mois
   * passé avec des ressources qui ne le couvraient pas. Une nouvelle version clôt
   * donc sa devancière **dans la transaction**, à la veille de sa date d'effet.
   */
  it('une nouvelle version clôt la précédente à la veille de sa date d’effet', async () => {
    const { db, updateSet } = fakeDbTransaction({
      versions: [ligneFoyerVersion({ dateEffet: '2026-01-01', dateFin: null })],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.mettreAJour(
      FOYER_ID,
      { ...DTO_FOYER, dateEffet: '2026-07-01' },
      ACTEUR,
    );

    // La version de janvier est close au 30 juin — la veille, pas le 1er juillet :
    // les deux périodes ne se chevauchent sur aucun jour.
    expect(updateSet).toHaveBeenCalledWith({ dateFin: '2026-06-30' });
    // La nouvelle version, elle, reste EN VIGUEUR (`date_fin` nulle) : aucun
    // `update` ne lui en pose une, c'est ce qui la protègera d'une purge.
    expect(
      updateSet.mock.calls.filter(
        (c) => (c[0] as { dateFin?: unknown }).dateFin === null,
      ),
    ).toHaveLength(0);
  });

  it('la fin matérialisée part sur le fil (FoyerMisAJour.v3)', async () => {
    const { db, insertValues } = fakeDbTransaction({
      versions: [
        ligneFoyerVersion({ dateEffet: '2026-01-01', dateFin: '2026-06-30' }),
      ],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.mettreAJour(FOYER_ID, DTO_FOYER, ACTEUR);

    // Sans ce champ, la copie aval devrait re-dériver la suite — et deux
    // dérivations finissent par diverger (c'est l'origine d'`AM-55`). On lit le
    // payload émis plutôt qu'un `objectContaining` imbriqué : la borne se vérifie
    // sur la valeur, pas sur la présence de la clé.
    const emis = insertValues.mock.calls
      .map((appel) => appel[0] as { type?: unknown; payload?: unknown })
      .filter((valeurs) => valeurs.type === FOYER_MIS_A_JOUR_V3_TYPE)
      .map((valeurs) => valeurs.payload as FoyerMisAJourPayloadV3);

    expect(emis.find((p) => p.dateEffet === '2026-01-01')?.dateFin).toBe(
      '2026-06-30',
    );
  });

  it('réutiliser une date existante = correction (journalisée, avant/après)', async () => {
    // Une version existe déjà au 2026-01-01 : ré-écrire cette date journalise.
    const { db, insertValues } = fakeDbTransaction({
      versions: [ligneFoyerVersion({ dateEffet: '2026-01-01' })],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.mettreAJour(
      FOYER_ID,
      {
        ...DTO_FOYER,
        rfr: 18000,
        dateEffet: '2026-01-01',
        motif: 'avis rectifié',
      },
      ACTEUR,
    );

    // Une ligne de correction_journal (avant/après) est écrite.
    const correction = insertValues.mock.calls.find(
      (c) => (c[0] as { avant?: unknown }).avant !== undefined,
    );
    expect(correction).toBeDefined();
    expect((correction?.[0] as { motif?: unknown }).motif).toBe(
      'avis rectifié',
    );
  });

  it('lève NotFoundException si le foyer est introuvable — AUCUN événement émis', async () => {
    const { db, insertValues } = fakeDbTransaction({ foyerPresent: false });
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.mettreAJour(FOYER_ID, DTO_FOYER, ACTEUR),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Le 404 est détecté AVANT toute écriture : pas d'événement fantôme.
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('FoyerService.obtenir / lister (tranche dérivée du barème versionné)', () => {
  it('dérive la tranche 1 d’un RFR < 20 000 €', async () => {
    const db = fakeDbLecture(
      [ligneFoyer({ rfrCentimes: 1500000 })],
      [ligneBaremeTranches()],
    );
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.obtenir(FOYER_ID);
    expect(vue).toMatchObject({ rfrEuros: 15000, tranche: 1 });
  });

  it('BVA : un RFR exactement au seuil de 20 000 € tombe en tranche 2', async () => {
    const db = fakeDbLecture(
      [ligneFoyer({ rfrCentimes: 2000000 })],
      [ligneBaremeTranches()],
    );
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.obtenir(FOYER_ID);
    expect(vue.tranche).toBe(2);
  });

  it('503 si le barème de tranches est froid (read-model vide) — jamais de tranche fausse', async () => {
    const db = fakeDbLecture([ligneFoyer()], []);
    const service = new FoyerService(db, new JournalAuditService());
    await expect(service.obtenir(FOYER_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lève NotFoundException si le foyer est introuvable', async () => {
    const db = fakeDbLecture([], [ligneBaremeTranches()]);
    const service = new FoyerService(db, new JournalAuditService());
    await expect(service.obtenir(FOYER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lister projette chaque ligne en vue (euros dérivés des centimes)', async () => {
    const autre = ligneFoyer({
      id: '33333333-3333-4333-8333-333333333333',
      rfrCentimes: 1000000,
    });
    const db = fakeDbLecture([ligneFoyer(), autre], [ligneBaremeTranches()]);
    const service = new FoyerService(db, new JournalAuditService());

    const vues = await service.lister();
    expect(vues).toHaveLength(2);
    expect(vues[0]).toMatchObject({ id: FOYER_ID, tranche: 3 });
    expect(vues[1]).toMatchObject({ rfrEuros: 10000, tranche: 1 });
  });
});

describe('FoyerService.listerVersions (historique des ressources)', () => {
  it('projette chaque version, plus récente d’abord, avec la tranche à sa date d’effet', async () => {
    const db = fakeDbLecture(
      [
        ligneFoyerVersion({
          id: 'v1',
          dateEffet: '2026-01-01',
          rfrCentimes: 7270500,
        }),
        ligneFoyerVersion({
          id: 'v2',
          dateEffet: '2027-01-01',
          rfrCentimes: 1500000,
        }),
      ],
      [ligneBaremeTranches()],
    );
    const service = new FoyerService(db, new JournalAuditService());

    const versions = await service.listerVersions(FOYER_ID);
    expect(versions.map((v) => v.dateEffet)).toEqual([
      '2027-01-01',
      '2026-01-01',
    ]);
    expect(versions[0]).toMatchObject({ tranche: 1, rfrEuros: 15000 });
    expect(versions[1]).toMatchObject({ tranche: 3, rfrEuros: 72705 });
  });
});

describe('FoyerService.ajouterEnfant (validation domaine + outbox)', () => {
  it('insère l’enfant + l’outbox EnfantAjoute dans la même transaction (prénom normalisé)', async () => {
    const { db, transaction, insertValues } = fakeDbTransaction({
      foyerPresent: true,
    });
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.ajouterEnfant(
      FOYER_ID,
      {
        prenom: '  Mia ',
        dateNaissance: '2024-03-15',
      },
      ACTEUR,
    );

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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.ajouterEnfant(
        FOYER_ID,
        {
          prenom: 'Mia',
          dateNaissance: '2024-03-15',
        },
        ACTEUR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('un prénom vide est refusé par le domaine AVANT toute transaction', async () => {
    const { db, transaction } = fakeDbTransaction({ foyerPresent: true });
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.ajouterEnfant(
        FOYER_ID,
        {
          prenom: '   ',
          dateNaissance: '2024-03-15',
        },
        ACTEUR,
      ),
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
    const service = new FoyerService(db, new JournalAuditService());

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
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.modifierEnfant(
      FOYER_ID,
      ENFANT_ID,
      {
        prenom: '  Zoé ',
        dateNaissance: '2023-03-12',
      },
      ACTEUR,
    );

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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.modifierEnfant(
        FOYER_ID,
        ENFANT_ID,
        {
          prenom: 'Zoé',
          dateNaissance: '2023-03-12',
        },
        ACTEUR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('un prénom vide est refusé par le domaine AVANT toute transaction', async () => {
    const { db, transaction } = fakeDbEnfantTx({ lignes: [ligneEnfant()] });
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.modifierEnfant(
        FOYER_ID,
        ENFANT_ID,
        {
          prenom: '   ',
          dateNaissance: '2023-03-12',
        },
        ACTEUR,
      ),
    ).rejects.toThrow('prénom');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('FoyerService.retirerEnfant (hard delete + événement)', () => {
  it('supprime l’enfant + émet EnfantRetire dans la même transaction', async () => {
    const { db, transaction, deleteWhere, insertValues } = fakeDbEnfantTx({
      lignes: [ligneEnfant()],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.retirerEnfant(FOYER_ID, ENFANT_ID, ACTEUR);

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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.retirerEnfant(FOYER_ID, ENFANT_ID, ACTEUR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

/**
 * Faux `db` transactionnel pour `supprimerFoyer` : `select().from().where()`
 * renvoie les parents du foyer (espionné via `selectFrom` — c'est la collecte
 * qui DOIT précéder le `DELETE`), `delete().where().returning()` renvoie
 * `lignes` (vide ⇒ foyer introuvable), `insertValues` espionne l'outbox.
 * `ordre` enregistre la séquence réelle des appels : la collecte des parents
 * après la cascade renverrait une liste vide sans que rien n'échoue.
 */
function fakeDbSuppressionTx(
  options: {
    lignes?: Record<string, unknown>[];
    parents?: { id: string }[];
  } = {},
): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  deleteWhere: ReturnType<typeof vi.fn>;
  ordre: string[];
} {
  const lignes = options.lignes ?? [];
  const parents = options.parents ?? [];
  const ordre: string[] = [];
  const insertValues = vi.fn(() => {
    ordre.push('insert');
    return Promise.resolve();
  });
  const deleteWhere = vi.fn(() => {
    ordre.push('delete');
    return { returning: () => Promise.resolve(lignes) };
  });
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          ordre.push('select');
          return Promise.resolve(parents);
        },
      }),
    }),
    insert: () => ({ values: insertValues }),
    delete: () => ({ where: deleteWhere }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, insertValues, deleteWhere, ordre };
}

describe('FoyerService.supprimerFoyer (cascade + événement d’intégration)', () => {
  const PARENT_ACTIF = '55555555-5555-4555-8555-555555555555';
  const PARENT_RETIRE = '66666666-6666-4666-8666-666666666666';

  it('supprime le foyer + émet FoyerSupprime portant TOUS ses parents', async () => {
    const { db, transaction, deleteWhere, insertValues } = fakeDbSuppressionTx({
      lignes: [{ id: FOYER_ID }],
      parents: [{ id: PARENT_ACTIF }, { id: PARENT_RETIRE }],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.supprimerFoyer(FOYER_ID, ACTEUR);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FOYER_SUPPRIME_TYPE,
        payload: {
          foyerId: FOYER_ID,
          parentIds: [PARENT_ACTIF, PARENT_RETIRE],
        },
      }),
    );
  });

  it('collecte les parents AVANT la cascade (sinon la liste serait vide)', async () => {
    const { db, ordre } = fakeDbSuppressionTx({
      lignes: [{ id: FOYER_ID }],
      parents: [{ id: PARENT_ACTIF }],
    });

    await new FoyerService(db, new JournalAuditService()).supprimerFoyer(
      FOYER_ID,
      ACTEUR,
    );

    expect(ordre).toEqual(['select', 'delete', 'insert']);
  });

  it('accepte un foyer sans parent (provisionné par un admin)', async () => {
    const { db, insertValues } = fakeDbSuppressionTx({
      lignes: [{ id: FOYER_ID }],
      parents: [],
    });

    await new FoyerService(db, new JournalAuditService()).supprimerFoyer(
      FOYER_ID,
      ACTEUR,
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { foyerId: FOYER_ID, parentIds: [] },
      }),
    );
  });

  it('lève NotFoundException si le foyer est introuvable — aucun événement émis', async () => {
    const { db, insertValues } = fakeDbSuppressionTx({ lignes: [] });

    await expect(
      new FoyerService(db, new JournalAuditService()).supprimerFoyer(
        FOYER_ID,
        ACTEUR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('un échec d’écriture de l’événement fait échouer la suppression (patron outbox)', async () => {
    // L'erreur remonte hors de la transaction : sur une vraie base le DELETE est
    // annulé — on ne peut pas effacer localement sans que l'aval l'apprenne.
    const db = {
      transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
        cb({
          select: () => ({
            from: () => ({ where: () => Promise.resolve([]) }),
          }),
          delete: () => ({
            where: () => ({
              returning: () => Promise.resolve([{ id: FOYER_ID }]),
            }),
          }),
          insert: () => ({
            values: () => Promise.reject(new Error('outbox indisponible')),
          }),
        }),
      ),
    } as unknown as Database;

    await expect(
      new FoyerService(db, new JournalAuditService()).supprimerFoyer(
        FOYER_ID,
        ACTEUR,
      ),
    ).rejects.toThrow('outbox indisponible');
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
    /**
     * Rejette l'erreur d'insert ENVELOPPÉE (forme réelle drizzle-orm ≥ 0.45 :
     * `DrizzleQueryError` avec la `PostgresError` en `cause`, plus au 1er niveau).
     */
    envelopperErreurInsert?: boolean;
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
    const erreurPg =
      options.erreurInsert && estParent
        ? Object.assign(new Error('violation unicité'), options.erreurInsert)
        : undefined;
    const erreur =
      erreurPg && options.envelopperErreurInsert
        ? Object.assign(new Error('Failed query: insert into "parent" …'), {
            cause: erreurPg,
          })
        : erreurPg;
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
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.ajouterParent(
      FOYER_ID,
      {
        email: 'parent@example.com',
        prenom: 'Alex',
        principal: true,
        ordre: 0,
      },
      ACTEUR,
    );

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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.ajouterParent(
        FOYER_ID,
        {
          email: 'parent@example.com',
          principal: false,
          ordre: 0,
        },
        ACTEUR,
      ),
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
    const service = new FoyerService(db, new JournalAuditService());

    const err = await service
      .ajouterParent(
        FOYER_ID,
        {
          email: 'parent@example.com',
          principal: false,
          ordre: 0,
        },
        ACTEUR,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'EMAIL_DEJA_UTILISE',
      message: 'adresse e-mail déjà utilisée dans ce foyer',
    });
  });

  it('traduit la violation ENVELOPPÉE par drizzle (PostgresError en cause) en 409 EMAIL_DEJA_UTILISE', async () => {
    // Forme réelle en base : drizzle-orm ≥ 0.45 enveloppe la PostgresError dans un
    // `DrizzleQueryError` — `code`/`constraint_name` sont dans `cause`, plus au
    // 1er niveau. Sans le déballage, l'erreur retraversait en 500 générique
    // (échec provider pact observé en CI).
    const { db } = fakeDbParentTx({
      foyerPresent: true,
      erreurInsert: {
        code: '23505',
        constraint_name: 'parent_email_par_foyer_actif_idx',
      },
      envelopperErreurInsert: true,
    });
    const service = new FoyerService(db, new JournalAuditService());

    const err = await service
      .ajouterParent(
        FOYER_ID,
        {
          email: 'parent@example.com',
          principal: false,
          ordre: 0,
        },
        ACTEUR,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'EMAIL_DEJA_UTILISE',
      message: 'adresse e-mail déjà utilisée dans ce foyer',
    });
  });

  it('traduit la violation ENVELOPPÉE du principal unique en 409 PARENT_PRINCIPAL_EXISTANT', async () => {
    const { db } = fakeDbParentTx({
      foyerPresent: true,
      erreurInsert: {
        code: '23505',
        constraint_name: 'parent_principal_unique_idx',
      },
      envelopperErreurInsert: true,
    });
    const service = new FoyerService(db, new JournalAuditService());

    const err = await service
      .ajouterParent(
        FOYER_ID,
        {
          email: 'parent@example.com',
          principal: true,
          ordre: 0,
        },
        ACTEUR,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'PARENT_PRINCIPAL_EXISTANT',
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
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.ajouterParent(
      FOYER_ID,
      {
        email: 'PARENT@example.com', // casse différente : match insensible à la casse
        prenom: 'Alex',
        principal: true,
        ordre: 0,
      },
      ACTEUR,
    );

    // Réactivation via UPDATE (actif=true + valeurs de la saisie), pas d'insert parent.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        actif: true,
        prenom: 'Alex',
        principal: true,
      }),
    );
    // AUCUNE ligne `parent` n'est insérée (c'est tout l'objet de la réactivation) :
    // le test porte sur l'absence d'insert de parent, pas sur un décompte global —
    // depuis le lot 6, la piste d'audit écrit elle aussi dans la transaction.
    expect(
      insertValues.mock.calls.filter(
        (appel) => (appel[0] as Record<string, unknown>)['email'] !== undefined,
      ),
    ).toEqual([]);
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
    const service = new FoyerService(db, new JournalAuditService());

    const err = await service
      .ajouterParent(
        FOYER_ID,
        {
          email: 'parent@example.com',
          principal: true,
          ordre: 0,
        },
        ACTEUR,
      )
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
    const service = new FoyerService(db, new JournalAuditService());

    const vue = await service.modifierParent(
      FOYER_ID,
      PARENT_ID,
      {
        email: 'neuf@example.com',
        actif: false,
      },
      ACTEUR,
    );

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
    const service = new FoyerService(db, new JournalAuditService());

    await service.modifierParent(FOYER_ID, PARENT_ID, {}, ACTEUR);
    const set = updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(set)).toEqual(['updatedAt']);
  });

  it('lève NotFoundException si le parent est introuvable — aucun événement', async () => {
    const { db, insertValues } = fakeDbParentTx({ lignesUpdate: [] });
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.modifierParent(FOYER_ID, PARENT_ID, { actif: false }, ACTEUR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('GARDE : modifierParent(actif:false) sur le DERNIER parent actif → 409 DERNIER_PARENT_ACTIF (aucune écriture)', async () => {
    const { db, updateSet, insertValues, forUpdate } = fakeDbParentTx({
      parentsActifs: [{ id: PARENT_ID }],
    });
    const service = new FoyerService(db, new JournalAuditService());

    const err = await service
      .modifierParent(FOYER_ID, PARENT_ID, { actif: false }, ACTEUR)
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
    const service = new FoyerService(db, new JournalAuditService());

    await service.modifierParent(FOYER_ID, PARENT_ID, { actif: false }, ACTEUR);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ actif: false }),
    );
  });

  it('GARDE : modifierParent SANS actif:false ne consulte pas les parents actifs', async () => {
    const { db, forUpdate } = fakeDbParentTx({
      lignesUpdate: [ligneParent({ email: 'neuf@example.com' })],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.modifierParent(
      FOYER_ID,
      PARENT_ID,
      {
        email: 'neuf@example.com',
      },
      ACTEUR,
    );
    expect(forUpdate).not.toHaveBeenCalled();
  });
});

describe('FoyerService.retirerParent (soft-delete + événement)', () => {
  it('passe actif=false + émet ParentRetire dans la même transaction (≥ 2 parents actifs)', async () => {
    const { db, transaction, updateSet, insertValues } = fakeDbParentTx({
      parentsActifs: [{ id: PARENT_ID }, { id: 'autre-parent' }],
      lignesUpdate: [ligneParent({ actif: false })],
    });
    const service = new FoyerService(db, new JournalAuditService());

    await service.retirerParent(FOYER_ID, PARENT_ID, ACTEUR);

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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.retirerParent(FOYER_ID, PARENT_ID, ACTEUR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('GARDE : retirer le DERNIER parent actif → 409 DERNIER_PARENT_ACTIF, aucune écriture', async () => {
    const { db, transaction, updateSet, insertValues, forUpdate } =
      fakeDbParentTx({
        parentsActifs: [{ id: PARENT_ID }],
        lignesUpdate: [ligneParent({ actif: false })],
      });
    const service = new FoyerService(db, new JournalAuditService());

    const err = await service
      .retirerParent(FOYER_ID, PARENT_ID, ACTEUR)
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
    const service = new FoyerService(db, new JournalAuditService());

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
    const service = new FoyerService(db, new JournalAuditService());

    const foyers = await service.foyersParEmail('  Parent@Example.com  ');
    expect(foyers).toEqual([FOYER_ID]);
  });

  it('renvoie [] pour un e-mail vide sans interroger la base', async () => {
    const db = {} as unknown as Database;
    const service = new FoyerService(db, new JournalAuditService());
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
    const service = new FoyerService(db, new JournalAuditService());

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
    const service = new FoyerService(db, new JournalAuditService());

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
    const service = new FoyerService(db, new JournalAuditService());
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
    const service = new FoyerService(db, new JournalAuditService());

    const prefs = await service.majPreferences(
      FOYER_ID,
      PARENT_ID,
      {
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
      },
      ACTEUR,
    );

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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.majPreferences(
        FOYER_ID,
        PARENT_ID,
        {
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
        },
        ACTEUR,
      ),
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
    const service = new FoyerService(db, new JournalAuditService());

    await expect(
      service.majPreferences(
        FOYER_ID,
        PARENT_ID,
        {
          preferences: [
            {
              typeNotification: 'VALIDATION_HEBDO',
              canal: 'EMAIL',
              actif: true,
            },
          ],
        },
        ACTEUR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

/**
 * Piste d'audit acteur (lot 6, `AM-45`). Ces tests n'utilisent **pas** de double du
 * `JournalAuditService` : le vrai service écrit dans le faux `tx`, et les
 * assertions portent sur la ligne réellement produite. Un double n'aurait prouvé
 * que l'appel, pas la ligne — et c'est la ligne qui est la piste.
 */
describe('FoyerService — piste d’audit acteur', () => {
  /** Lignes `journal_audit` réellement insérées (discriminées par `action`). */
  function lignesAudit(
    insertValues: ReturnType<typeof vi.fn>,
  ): Record<string, unknown>[] {
    return insertValues.mock.calls
      .map((appel) => appel[0] as Record<string, unknown>)
      .filter((valeurs) => typeof valeurs['action'] === 'string');
  }

  it('trace le retrait d’un enfant, que le DELETE rend intraçable autrement', async () => {
    const { db, insertValues } = fakeDbEnfantTx({ lignes: [ligneEnfant()] });

    await new FoyerService(db, new JournalAuditService()).retirerEnfant(
      FOYER_ID,
      ENFANT_ID,
      ACTEUR,
    );

    expect(lignesAudit(insertValues)).toEqual([
      {
        foyerId: FOYER_ID,
        action: ACTIONS_AUDIT.ENFANT_RETIRE,
        cibleType: 'enfant',
        cibleId: ENFANT_ID,
        acteurType: 'parent',
        acteur: 'claire@example.test',
      },
    ]);
  });

  it('distingue une saisie de ressources d’une correction, et vise la ligne de correction', async () => {
    // Date d'effet libre → saisie.
    const saisie = fakeDbTransaction();
    await new FoyerService(saisie.db, new JournalAuditService()).mettreAJour(
      FOYER_ID,
      { ...DTO_FOYER, dateEffet: '2027-01-01' },
      ACTEUR,
    );
    expect(lignesAudit(saisie.insertValues)).toEqual([
      expect.objectContaining({
        action: ACTIONS_AUDIT.RESSOURCES_SAISIES,
        cibleType: 'foyer_version',
      }),
    ]);

    // Même date qu'une version existante → correction rétroactive.
    const correction = fakeDbTransaction({
      versions: [ligneFoyerVersion({ dateEffet: '2026-01-01' })],
    });
    await new FoyerService(
      correction.db,
      new JournalAuditService(),
    ).mettreAJour(
      FOYER_ID,
      { ...DTO_FOYER, rfr: 18000, dateEffet: '2026-01-01' },
      ACTEUR,
    );
    const [ligne] = lignesAudit(correction.insertValues);
    expect(ligne).toMatchObject({
      action: ACTIONS_AUDIT.RESSOURCES_CORRIGEES,
      cibleType: 'correction_journal',
    });
    // La cible EST la ligne de correction écrite dans la même transaction : c'est
    // ce qui rend le rapprochement exact quand une version est corrigée deux fois.
    const ligneCorrection = correction.insertValues.mock.calls
      .map((appel) => appel[0] as Record<string, unknown>)
      .find((valeurs) => valeurs['avant'] !== undefined);
    expect(ligne?.['cibleId']).toBe(ligneCorrection?.['id']);
  });

  it('écrit la ligne même sans acteur établi, en le nommant « inconnu »', async () => {
    // Mode observe : assertion absente ou invalide ⇒ la mutation a lieu quand
    // même. Ne rien écrire rendrait la piste indiscernable d'une piste vide.
    const { db, insertValues } = fakeDbEnfantTx({ lignes: [ligneEnfant()] });

    await new FoyerService(db, new JournalAuditService()).retirerEnfant(
      FOYER_ID,
      ENFANT_ID,
      { type: 'inconnu' },
    );

    expect(lignesAudit(insertValues)[0]).toMatchObject({
      acteurType: 'inconnu',
      // Nul, et non le mot « inconnu » : une colonne portant ce texte serait
      // indiscernable d'un acteur réellement nommé ainsi.
      acteur: null,
    });
  });

  it('n’écrit AUCUNE ligne pour l’effacement du foyer — la table part avec lui', async () => {
    const { db, insertValues } = fakeDbSuppressionTx({
      lignes: [{ id: FOYER_ID }],
      parents: [{ id: PARENT_ID }],
    });

    await new FoyerService(db, new JournalAuditService()).supprimerFoyer(
      FOYER_ID,
      ACTEUR,
    );

    // `journal_audit` référence `foyer` en ON DELETE CASCADE : insérée avant le
    // DELETE elle serait emportée, après elle violerait la clé étrangère. Cette
    // action-là n'a que le journal applicatif (doc 37 T5, §7).
    expect(lignesAudit(insertValues)).toEqual([]);
    // L'événement d'intégration, lui, part bien : rien d'autre n'a changé.
    expect(insertValues).toHaveBeenCalledTimes(1);
  });
});
