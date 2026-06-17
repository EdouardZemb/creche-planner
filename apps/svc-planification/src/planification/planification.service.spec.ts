import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  PLANNING_MODIFIE_TYPE,
} from '@creche-planner/contracts-planification';
import type {
  PrestationsMoisCantine,
  PrestationsMoisCreche,
  PrestationsMoisPeriscolaire,
} from '@creche-planner/planification-domain';
import { PlanificationService } from './planification.service.js';
import type { Database } from '../database/database.types.js';
import type { ContratRow } from '../database/schema.js';
import type { ReferentielClient } from './referentiel.client.js';
import type {
  EcrirePlanningDto,
  ModifierContratDto,
} from './planification.dto.js';

/**
 * Tests unitaires du `PlanificationService` SANS infra (Postgres mocké). On
 * construit `new PlanificationService(fakeDb, fakeReferentiel)` avec un faux `db`
 * renvoyant des lignes canned et un faux référentiel. La projection effective
 * (SQL réel) reste couverte par la vérification Pact provider (base réelle en CI).
 */

const CONTRAT_ID = '55555555-5555-4555-8555-555555555555';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const MOIS = '2026-10'; // octobre 2026 : 05 = lundi, 06 = mardi, 15 = jeudi.

/** Ligne contrat crèche PSU : semaine type avec une plage le lundi (8h30→17h00). */
function ligneCreche(overrides: Partial<ContratRow> = {}): ContratRow {
  return {
    id: CONTRAT_ID,
    foyerId: FOYER_ID,
    enfant: 'Mia',
    mode: 'CRECHE_PSU',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: {
      LUNDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
      ],
    },
    semaineAbcm: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as ContratRow;
}

/** Ligne contrat ABCM (cantine/péri/alsh) : semaine type ABCM. */
function ligneAbcm(
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH',
  semaineAbcm: unknown,
): ContratRow {
  return {
    id: CONTRAT_ID,
    foyerId: FOYER_ID,
    enfant: 'Zoé',
    mode,
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: null,
    nbMensualites: null,
    semaineType: null,
    semaineAbcm,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as ContratRow;
}

/**
 * Faux `db` pour les lectures (`lirePlanning`, `prestationsMois`, `listerContrats`).
 * `select()` renvoie un objet chaînable dont `from().where()` (et `.orderBy()`)
 * résout vers le tableau de lignes pré-programmé pour cet appel. Les appels
 * successifs consomment `reponses` dans l'ordre (1ᵉʳ select = contrat, 2ᵉ = planning).
 */
function fakeDbLecture(...reponses: unknown[][]): Database {
  let i = 0;
  const select = vi.fn(() => {
    const lignes = reponses[i++] ?? [];
    const resultat = Promise.resolve(lignes);
    const chaine = {
      where: vi.fn(() => Object.assign(Promise.resolve(lignes), chaine)),
      orderBy: vi.fn(() => resultat),
      from: vi.fn(() => chaine),
    };
    return chaine;
  });
  return { select } as unknown as Database;
}

const referentielVide = {
  joursNonFacturables: vi.fn(async () => [] as string[]),
} as unknown as ReferentielClient;

describe('PlanificationService.prestationsMois (crèche)', () => {
  it('mappe une plage cohérente en durée (jour sup) → agrégée au complément', async () => {
    const saisie: EcrirePlanningDto = {
      // mardi 06 hors semaine type → +4h (240 min) au complément.
      joursSupplementaires: [
        {
          date: '2026-10-06',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 12,
          finMinutes: 0,
        },
      ],
    };
    const db = fakeDbLecture([ligneCreche()], [{ saisie }]);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    expect(presta.mode).toBe('CRECHE_PSU');
    expect(presta.complement.enMinutes).toBe(240);
  });

  it('ignore (filtre) un jour supplémentaire à plage incohérente (fin ≤ début)', async () => {
    const saisie: EcrirePlanningDto = {
      joursSupplementaires: [
        // fin = début → durée nulle → filtré (sinon Duree.entre lèverait).
        {
          date: '2026-10-06',
          debutHeures: 9,
          debutMinutes: 0,
          finHeures: 9,
          finMinutes: 0,
        },
      ],
    };
    const db = fakeDbLecture([ligneCreche()], [{ saisie }]);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    // Le jour incohérent est ignoré : aucun complément ajouté.
    expect(presta.complement.enMinutes).toBe(0);
  });

  it('déduit une absence datée éligible (préavis ≥ 2) sur les heures réservées', async () => {
    const saisie: EcrirePlanningDto = {
      absences: [
        {
          date: '2026-10-05', // lundi : couvert par la semaine type.
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    };
    const db = fakeDbLecture([ligneCreche()], [{ saisie }]);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    // Absence 8h30→12h30 = 4h (240 min) déduites.
    expect(presta.heuresDeduites.enMinutes).toBe(240);
  });

  it('ne déduit pas une absence non éligible (préavis < 2, sans certificat)', async () => {
    const saisie: EcrirePlanningDto = {
      absences: [
        {
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 0,
          certificatMaladie: false,
        },
      ],
    };
    const db = fakeDbLecture([ligneCreche()], [{ saisie }]);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    expect(presta.heuresDeduites.enMinutes).toBe(0);
  });

  it('exclut un jour non facturable des heures réservées (référentiel)', async () => {
    const refUnJour = {
      joursNonFacturables: vi.fn(async () => ['2026-10-05']),
    } as unknown as ReferentielClient;
    // Sans saisie : seules les heures réservées de la semaine type comptent.
    const db = fakeDbLecture([ligneCreche()], []);
    const service = new PlanificationService(db, refUnJour);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    // Lundis d'octobre 2026 : 05, 12, 19, 26 = 4 lundis × 8h30 = 2040 min.
    // Le 05 exclu (non facturable) → 3 × 510 = 1530 min.
    expect(presta.heuresReservees.enMinutes).toBe(1530);
  });

  it('lève NotFoundException si le contrat est introuvable', async () => {
    const db = fakeDbLecture([]); // aucune ligne contrat.
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.prestationsMois(CONTRAT_ID, MOIS, false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlanificationService.prestationsMois (ABCM / exceptions)', () => {
  it('cantine : un override d’exception (cantine:true) ajoute un jour non prévu', async () => {
    // Semaine type vide → 0 jour de base ; exception le lundi 05 → +1 jour.
    const db = fakeDbLecture(
      [ligneAbcm('CANTINE', {})],
      [{ saisie: { exceptions: [{ date: '2026-10-05', cantine: true }] } }],
    );
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCantine;
    expect(presta.mode).toBe('CANTINE');
    expect(presta.nbJours).toBe(1);
  });

  it('cantine : un override d’exception (cantine:false) retire un jour prévu', async () => {
    // Semaine type : cantine tous les lundis (4 lundis) ; exception retire le 05.
    const db = fakeDbLecture(
      [ligneAbcm('CANTINE', { LUNDI: { cantine: true } })],
      [{ saisie: { exceptions: [{ date: '2026-10-05', cantine: false }] } }],
    );
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCantine;
    // 4 lundis − 1 retiré = 3.
    expect(presta.nbJours).toBe(3);
  });

  it('périscolaire : exception undefined hérite de la semaine type', async () => {
    // periMatin tous les lundis ; exception sur le 05 ne touche que periSoir,
    // periMatin (undefined) hérite donc de la semaine type → reste compté.
    const db = fakeDbLecture(
      [ligneAbcm('PERISCOLAIRE', { LUNDI: { periMatin: true } })],
      [{ saisie: { exceptions: [{ date: '2026-10-05', periSoir: true }] } }],
    );
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisPeriscolaire;
    expect(presta.mode).toBe('PERISCOLAIRE');
    expect(presta.nbMatins).toBe(4); // 4 lundis, héritage conservé.
    expect(presta.nbSoirs).toBe(1); // un seul soir ajouté par l'exception.
  });
});

describe('PlanificationService.lirePlanning', () => {
  it('round-trip : renvoie exactement la saisie stockée', async () => {
    const saisie: EcrirePlanningDto = {
      complementMinutes: 30,
      absences: [],
    };
    const db = fakeDbLecture([ligneCreche()], [{ saisie }]);
    const service = new PlanificationService(db, referentielVide);

    const lu = await service.lirePlanning(CONTRAT_ID, MOIS, false);
    expect(lu).toEqual(saisie);
  });

  it('renvoie null si aucune saisie n’est enregistrée', async () => {
    const db = fakeDbLecture([ligneCreche()], []);
    const service = new PlanificationService(db, referentielVide);

    const lu = await service.lirePlanning(CONTRAT_ID, MOIS, false);
    expect(lu).toBeNull();
  });

  it('lève NotFoundException si le contrat est introuvable', async () => {
    const db = fakeDbLecture([]);
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.lirePlanning(CONTRAT_ID, MOIS, false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlanificationService.listerContrats', () => {
  it('projette les lignes en ContratDetailVue (lecture seule, triée)', async () => {
    const db = fakeDbLecture([ligneCreche(), ligneAbcm('CANTINE', {})]);
    const service = new PlanificationService(db, referentielVide);

    const vues = await service.listerContrats(FOYER_ID);
    expect(vues).toHaveLength(2);
    expect(vues[0]).toMatchObject({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
    });
  });
});

/**
 * Faux `tx` transactionnel instrumenté : `select().from().where()` renvoie
 * `contratPresent` (pour le garde 404). `insert/update/delete` renvoient des
 * chaînes espionnables (`onConflictDoUpdate`, `values`, `set`, `where`). Les
 * espions sont exposés pour vérifier l'upsert et l'insertion outbox.
 */
function fakeDbTransaction(contratPresent: boolean): {
  db: Database;
  insertValues: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
} {
  const insertValues = vi.fn();
  const onConflictDoUpdate = vi.fn(() => Promise.resolve());
  const lignes = contratPresent ? [ligneCreche()] : [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(lignes) }) }),
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return Object.assign(Promise.resolve(), { onConflictDoUpdate });
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => {
      await cb(tx);
    }),
  } as unknown as Database;
  return { db, insertValues, onConflictDoUpdate };
}

describe('PlanificationService.ecrirePlanning', () => {
  it('upsert le planning + insère l’outbox PlanningModifie (même transaction)', async () => {
    const { db, insertValues, onConflictDoUpdate } = fakeDbTransaction(true);
    const service = new PlanificationService(db, referentielVide);
    const dto: EcrirePlanningDto = { complementMinutes: 15 };

    await service.ecrirePlanning(CONTRAT_ID, MOIS, false, dto);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // Upsert : insert planning avec onConflictDoUpdate (idempotence).
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    // L'insert du planning porte la saisie.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        contratId: CONTRAT_ID,
        mois: MOIS,
        saisie: dto,
      }),
    );
    // L'outbox porte l'événement PlanningModifie avec le bon payload.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PLANNING_MODIFIE_TYPE,
        payload: expect.objectContaining({
          contratId: CONTRAT_ID,
          mois: MOIS,
          simule: false,
        }),
      }),
    );
  });

  it('lève NotFoundException si le contrat est introuvable', async () => {
    const { db } = fakeDbTransaction(false);
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.ecrirePlanning(CONTRAT_ID, MOIS, false, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlanificationService.creerContrat', () => {
  it('insère le contrat + l’outbox ContratCree (même transaction)', async () => {
    const { db, insertValues } = fakeDbTransaction(true);
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.creerContrat({
      mode: 'CRECHE_PSU',
      foyerId: FOYER_ID,
      enfant: 'Mia',
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      // Le front envoie toujours les 7 jours (tableau vide = jour non gardé) ;
      // `z.record(<enum>, …)` de Zod v4 exige d'ailleurs les 7 clés.
      semaineType: {
        LUNDI: [
          { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
        ],
        MARDI: [],
        MERCREDI: [],
        JEUDI: [],
        VENDREDI: [],
        SAMEDI: [],
        DIMANCHE: [],
      },
    });

    expect(vue).toMatchObject({ foyerId: FOYER_ID, mode: 'CRECHE_PSU' });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_CREE_TYPE,
        payload: expect.objectContaining({ foyerId: FOYER_ID, enfant: 'Mia' }),
      }),
    );
  });
});

/**
 * Faux `db` transactionnel pour `modifierContrat`, instrumenté pour vérifier
 * l'**atomicité** : on espionne séparément l'`update` du contrat, le `delete`
 * des `planning_mois` (cascade) et l'`insert` outbox, tous censés se produire
 * dans une **unique** `db.transaction`. `contratPresent` pilote le garde 404 ;
 * `echecOutbox` simule un échec EN COURS de transaction (l'insert outbox rejette)
 * → sur une vraie base, le rollback annule l'update ET le delete ensemble, donc
 * le contrat n'est jamais supprimé ni laissé incohérent.
 */
function fakeDbModif(options: {
  contratPresent: boolean;
  echecOutbox?: boolean;
}): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  deleteWhere: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
} {
  const updateSet = vi.fn(() => ({ where: () => Promise.resolve() }));
  const deleteWhere = vi.fn(() => Promise.resolve());
  const insertValues = vi.fn(() =>
    options.echecOutbox
      ? Promise.reject(new Error('outbox indisponible'))
      : Promise.resolve(),
  );
  const lignes = options.contratPresent ? [ligneCreche()] : [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(lignes) }) }),
    update: () => ({ set: updateSet }),
    delete: () => ({ where: deleteWhere }),
    insert: () => ({ values: insertValues }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<void>) => {
    await cb(tx);
  });
  const db = { transaction } as unknown as Database;
  return { db, transaction, updateSet, deleteWhere, insertValues };
}

/** DTO de modification valide (crèche PSU) — les 7 jours, comme l'envoie le front. */
const DTO_MODIF_VALIDE: ModifierContratDto = {
  mode: 'CRECHE_PSU',
  foyerId: FOYER_ID,
  enfant: 'Mia',
  valideDu: '2026-01-01',
  valideAu: '2026-12-31',
  heuresAnnuellesContractualisees: 885.5,
  nbMensualites: 7,
  semaineType: {
    LUNDI: [{ debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 }],
    MARDI: [],
    MERCREDI: [],
    JEUDI: [],
    VENDREDI: [],
    SAMEDI: [],
    DIMANCHE: [],
  },
};

describe('PlanificationService.modifierContrat (atomicité / invariant contrat)', () => {
  it('update contrat + delete planning_mois + outbox dans UNE seule transaction', async () => {
    const { db, transaction, updateSet, deleteWhere, insertValues } =
      fakeDbModif({ contratPresent: true });
    const service = new PlanificationService(db, referentielVide);

    await service.modifierContrat(CONTRAT_ID, DTO_MODIF_VALIDE);

    // Tout est groupé dans une transaction unique (atomicité Drizzle) : pas de
    // suppression « hors transaction » qui pourrait survivre à un échec partiel.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1); // cascade planning_mois
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_MODIFIE_TYPE,
        payload: expect.objectContaining({ contratId: CONTRAT_ID }),
      }),
    );
  });

  it('INVARIANT : une validation domaine en échec ne touche JAMAIS la base (aucune transaction ouverte)', async () => {
    const { db, transaction, updateSet, deleteWhere } = fakeDbModif({
      contratPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    // valideAu < valideDu → PeriodeContratInvalideError AVANT toute écriture.
    await expect(
      service.modifierContrat(CONTRAT_ID, {
        ...DTO_MODIF_VALIDE,
        valideDu: '2026-12-31',
        valideAu: '2026-01-01',
      }),
    ).rejects.toThrow();

    // Le contrat existant n'est ni mis à jour ni supprimé : il reste intact.
    expect(transaction).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('INVARIANT : un échec EN COURS de transaction se propage (rollback) → le contrat n’est jamais supprimé', async () => {
    const { db, transaction, deleteWhere } = fakeDbModif({
      contratPresent: true,
      echecOutbox: true,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.modifierContrat(CONTRAT_ID, DTO_MODIF_VALIDE),
    ).rejects.toThrow('outbox indisponible');

    // L'échec survient DANS l'unique transaction : sur une vraie base, update +
    // delete sont annulés ensemble (le delete a été *tenté* mais sera rollback).
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('lève NotFoundException si le contrat est introuvable, sans rien modifier ni supprimer', async () => {
    const { db, updateSet, deleteWhere } = fakeDbModif({
      contratPresent: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.modifierContrat(CONTRAT_ID, DTO_MODIF_VALIDE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateSet).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
