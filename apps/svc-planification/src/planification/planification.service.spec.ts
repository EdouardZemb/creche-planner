import { describe, expect, it, vi } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CONTRAT_CREE_V2_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_MODIFIE_V2_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  PLANNING_MODIFIE_TYPE,
} from '@creche-planner/contracts-planification';
import type {
  PrestationsMoisCantine,
  PrestationsMoisCreche,
  PrestationsMoisPeriscolaire,
} from '@creche-planner/planification-domain';
import { PlanificationService } from './planification.service.js';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  contratVersion,
  correctionJournal,
  etablissement,
  outbox,
  planningMois,
} from '../database/schema.js';
import type { ContratRow, ContratVersionRow } from '../database/schema.js';
import type { ReferentielClient } from './referentiel.client.js';
import type {
  CorrigerVersionDto,
  CreerAvenantDto,
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
// Établissement de référence : depuis P5 (`etablissement_id` NOT NULL) un contrat
// est TOUJOURS rattaché ; `AUTRE_ETAB_ID` sert aux scénarios de re-pointage.
const ETAB_ID = '99999999-9999-4999-8999-999999999999';
const AUTRE_ETAB_ID = '88888888-8888-4888-8888-888888888888';
// Enfant de référence (agrégat svc-foyer) ; `AUTRE_ENFANT_ID` sert au re-pointage.
const ENFANT_ID = '77777777-7777-4777-8777-777777777777';
const AUTRE_ENFANT_ID = '66666666-6666-4666-8666-666666666666';

/** Ligne contrat crèche PSU : semaine type avec une plage le lundi (8h30→17h00). */
function ligneCreche(overrides: Partial<ContratRow> = {}): ContratRow {
  return {
    id: CONTRAT_ID,
    foyerId: FOYER_ID,
    enfant: 'Mia',
    enfantId: ENFANT_ID,
    mode: 'CRECHE_PSU',
    etablissementId: ETAB_ID,
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    premiereInscription: false,
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
  };
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
    enfantId: ENFANT_ID,
    mode,
    etablissementId: ETAB_ID,
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    premiereInscription: false,
    heuresAnnuellesContractualisees: null,
    nbMensualites: null,
    semaineType: null,
    semaineAbcm,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
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

describe('PlanificationService.prestationsMois (résolution temporelle, SFD 30 lot 4)', () => {
  // Octobre 2026 : lundis 05, 12, 19, 26.
  it('avenant à cheval (effet 2026-10-15) : jours par version, mensualité du 1er (H7)', async () => {
    const versions = [
      versionRow({ dateEffet: '2026-01-01' }), // lundi 8h30→17h00 (510 min)
      versionRow({
        id: '10000000-0000-4000-8000-000000000002',
        dateEffet: '2026-10-15',
        heuresAnnuellesContractualisees: 700,
        semaineType: {
          LUNDI: [
            { debutHeures: 8, debutMinutes: 30, finHeures: 12, finMinutes: 30 },
          ],
        },
      }),
    ];
    const db = fakeDbLecture([ligneCreche()], [], versions);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    // Lundis 05 et 12 selon l'ancienne version (510), 19 et 26 selon la
    // nouvelle (240) — les jours 1-14 restent générés par l'ancienne (CA US-30-01).
    expect(presta.heuresReservees.enMinutes).toBe(2 * 510 + 2 * 240);
    // Mensualité (H7) : celle de la version applicable au 1er du mois.
    expect(presta.heuresMensualisees).toBe(126.5); // 885.5 / 7
  });

  it('avenant à effet futur (2026-11-01) : le mois courant reste généré par la version en vigueur', async () => {
    const versions = [
      versionRow({ dateEffet: '2026-01-01' }),
      versionRow({
        id: '10000000-0000-4000-8000-000000000003',
        dateEffet: '2026-11-01',
        heuresAnnuellesContractualisees: 700,
        semaineType: { MARDI: [] },
      }),
    ];
    const db = fakeDbLecture([ligneCreche()], [], versions);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    // Octobre entier généré par la version du 01/01 : 4 lundis × 510 min.
    expect(presta.heuresReservees.enMinutes).toBe(4 * 510);
    expect(presta.heuresMensualisees).toBe(126.5);
  });

  it('contrat sans version (repli défensif) : colonnes-projection en un seul segment', async () => {
    const db = fakeDbLecture([ligneCreche()], [], []);
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    expect(presta.heuresReservees.enMinutes).toBe(4 * 510);
  });

  it('mois hors vie du contrat : quantités nulles (segment courant vide)', async () => {
    // Contrat clos au 2026-07-31 : octobre est hors période, même versionné.
    const versions = [versionRow({ dateEffet: '2026-01-01' })];
    const db = fakeDbLecture(
      [ligneCreche({ valideAu: '2026-07-31' })],
      [],
      versions,
    );
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCreche;
    expect(presta.heuresReservees.enMinutes).toBe(0);
    expect(presta.heuresMensualisees).toBe(0);
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

describe('PlanificationService.lireContrat (résolution contrat → foyer, authz)', () => {
  it('projette le cœur du contrat (id, foyer, enfant, mode, dates)', async () => {
    const db = fakeDbLecture([ligneCreche()]);
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.lireContrat(CONTRAT_ID);

    expect(vue).toMatchObject({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      enfantId: ENFANT_ID,
      mode: 'CRECHE_PSU',
      premiereInscription: false,
    });
  });

  it('lève NotFoundException si le contrat est introuvable', async () => {
    const db = fakeDbLecture([]);
    const service = new PlanificationService(db, referentielVide);

    await expect(service.lireContrat(CONTRAT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PlanificationService.supprimerContrat', () => {
  it('supprime le contrat + ses plannings (cascade) + émet ContratSupprime dans une seule transaction', async () => {
    const { db, transaction, deleteWhere, insertValues } = fakeDbModif({
      contratPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    await service.supprimerContrat(CONTRAT_ID);

    expect(transaction).toHaveBeenCalledTimes(1);
    // Cascade explicite : suppression des planning_mois PUIS du contrat.
    expect(deleteWhere).toHaveBeenCalledTimes(2);
    // L'outbox porte ContratSupprime avec le contratId, dans la même transaction.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_SUPPRIME_TYPE,
        payload: expect.objectContaining({ contratId: CONTRAT_ID }),
      }),
    );
  });

  it('lève NotFoundException si le contrat est introuvable, sans rien supprimer ni émettre', async () => {
    const { db, deleteWhere, insertValues } = fakeDbModif({
      contratPresent: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(service.supprimerContrat(CONTRAT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
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
  // `actif: true` : ce fake sert aussi la résolution d'établissement de `creerContrat`
  // (Lot 3 lit `actif` sur la ligne établissement) — un actif ne déclenche pas le rejet.
  const lignes = contratPresent ? [{ ...ligneCreche(), actif: true }] : [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(lignes) }) }),
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        // Insert idempotent (Lot 3) : `.onConflictDoNothing().returning()` renvoie
        // une ligne (pas de conflit dans ce fake sans état) → chemin nominal.
        const returning = (): Promise<{ id: string }[]> =>
          Promise.resolve([{ id: CONTRAT_ID }]);
        return Object.assign(Promise.resolve(), {
          onConflictDoUpdate,
          onConflictDoNothing: () => ({ returning }),
        });
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
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

/**
 * Faux `db` transactionnel pour `ecrireSemaine`, instrumenté pour vérifier
 * l'**atomicité de bout en bout** : la garde contrat, les lectures de planning et
 * les upserts+outbox de TOUS les mois recouverts doivent se produire dans une
 * **unique** `db.transaction` (une semaine à cheval = 2 mois, jamais 2
 * transactions). Le 1ᵉʳ `select` sert la garde 404 (`contratPresent`), les suivants
 * sont les lectures par mois (aucune saisie → `null`, la fusion pure est testée à
 * part). On distingue l'upsert planning (porte `saisie` + `.onConflictDoUpdate`) de
 * l'insert outbox (porte `type`). `echecSurMois` simule un crash EN COURS de
 * transaction (l'upsert de CE mois rejette) → sur une vraie base, le rollback annule
 * les DEUX mois ensemble : jamais de semaine à moitié écrite.
 */
function fakeDbSemaine(options: {
  contratPresent: boolean;
  echecSurMois?: string;
}): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  planningUpserts: Record<string, unknown>[];
  outboxEvents: Record<string, unknown>[];
} {
  const planningUpserts: Record<string, unknown>[] = [];
  const outboxEvents: Record<string, unknown>[] = [];
  let selectCall = 0;
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall += 1;
          // 1ᵉʳ select = garde contrat ; les suivants = lectures planning (vides).
          if (selectCall === 1) {
            return Promise.resolve(
              options.contratPresent ? [ligneCreche()] : [],
            );
          }
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        // Upsert planning (porte `saisie` + `.onConflictDoUpdate`) vs outbox (`type`).
        if ('saisie' in v) {
          planningUpserts.push(v);
          const echoue = v['mois'] === options.echecSurMois;
          return Object.assign(Promise.resolve(), {
            onConflictDoUpdate: () =>
              echoue
                ? Promise.reject(new Error('crash upsert 2e mois'))
                : Promise.resolve(),
          });
        }
        outboxEvents.push(v);
        return Promise.resolve();
      },
    }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<void>) => {
    await cb(tx);
  });
  const db = { transaction } as unknown as Database;
  return { db, transaction, planningUpserts, outboxEvents };
}

describe('PlanificationService.ecrireSemaine', () => {
  /** Besoins datés d'une semaine : un jour supplémentaire crèche. */
  function jourSup(date: string): EcrirePlanningDto {
    return {
      joursSupplementaires: [
        { date, debutHeures: 9, debutMinutes: 0, finHeures: 12, finMinutes: 0 },
      ],
    };
  }

  /** Indexe les upserts capturés par mois → saisie fusionnée. */
  function saisiesParMois(
    upserts: Record<string, unknown>[],
  ): Map<string, EcrirePlanningDto> {
    return new Map(
      upserts.map((u): [string, EcrirePlanningDto] => [
        u['mois'] as string,
        u['saisie'] as EcrirePlanningDto,
      ]),
    );
  }

  it('mono-mois : un seul read→merge→write dans une transaction', async () => {
    const { db, transaction, planningUpserts, outboxEvents } = fakeDbSemaine({
      contratPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    await service.ecrireSemaine(
      CONTRAT_ID,
      '2026-W11',
      false,
      jourSup('2026-03-12'),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(planningUpserts).toHaveLength(1);
    expect(planningUpserts[0]).toMatchObject({
      contratId: CONTRAT_ID,
      mois: '2026-03',
      simule: false,
    });
    expect(
      saisiesParMois(planningUpserts).get('2026-03')?.joursSupplementaires?.[0]
        ?.date,
    ).toBe('2026-03-12');
    // Un seul événement PlanningModifie pour le mois édité.
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      type: PLANNING_MODIFIE_TYPE,
      payload: { contratId: CONTRAT_ID, mois: '2026-03', simule: false },
    });
  });

  it('à cheval 2 mois : UNE seule transaction, jours routés vers LEUR mois, un event par mois', async () => {
    const { db, transaction, planningUpserts, outboxEvents } = fakeDbSemaine({
      contratPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    // 2026-W14 = 30,31 mars | 01→05 avril. Besoins sur les deux mois.
    const besoins: EcrirePlanningDto = {
      joursSupplementaires: [
        ...(jourSup('2026-03-31').joursSupplementaires ?? []),
        ...(jourSup('2026-04-02').joursSupplementaires ?? []),
      ],
    };
    await service.ecrireSemaine(CONTRAT_ID, '2026-W14', false, besoins);

    // Les DEUX mois sont écrits dans une SEULE transaction (atomicité à cheval).
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(planningUpserts).toHaveLength(2);
    const parMois = saisiesParMois(planningUpserts);
    // Mars ne reçoit que le 31 ; avril que le 02 (fusion routée par mois).
    expect(
      (parMois.get('2026-03')?.joursSupplementaires ?? []).map((j) => j.date),
    ).toEqual(['2026-03-31']);
    expect(
      (parMois.get('2026-04')?.joursSupplementaires ?? []).map((j) => j.date),
    ).toEqual(['2026-04-02']);
    // Un événement PlanningModifie par mois modifié (consommateurs keyed par mois).
    expect(outboxEvents).toHaveLength(2);
    expect(outboxEvents.every((e) => e['type'] === PLANNING_MODIFIE_TYPE)).toBe(
      true,
    );
    expect(
      outboxEvents
        .map((e) => (e['payload'] as { mois: string }).mois)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['2026-03', '2026-04']);
  });

  it('INVARIANT : un crash sur le 2ᵉ mois se propage (rollback) → une seule transaction, aucun event du 2ᵉ mois', async () => {
    // 2026-W14 à cheval mars/avril ; l'upsert d'avril (2ᵉ mois) échoue EN COURS
    // de transaction. Sur une vraie base, le rollback annule AUSSI mars : jamais
    // de semaine à moitié écrite ni de snapshot de notification divergent.
    const { db, transaction, planningUpserts, outboxEvents } = fakeDbSemaine({
      contratPresent: true,
      echecSurMois: '2026-04',
    });
    const service = new PlanificationService(db, referentielVide);

    const besoins: EcrirePlanningDto = {
      joursSupplementaires: [
        ...(jourSup('2026-03-31').joursSupplementaires ?? []),
        ...(jourSup('2026-04-02').joursSupplementaires ?? []),
      ],
    };
    await expect(
      service.ecrireSemaine(CONTRAT_ID, '2026-W14', false, besoins),
    ).rejects.toThrow('crash upsert 2e mois');

    // Les deux mois partagent l'UNIQUE transaction (≠ ancien code : 1 tx/mois) :
    // l'échec du 2ᵉ mois rollback le 1ᵉʳ. On observe que le 2ᵉ mois n'a jamais
    // émis son event (l'upsert a jeté avant l'insert outbox), et que mars — bien
    // qu'inséré — sera annulé par le rollback puisque tout est dans la même tx.
    expect(transaction).toHaveBeenCalledTimes(1);
    // Les deux upserts ont été TENTÉS dans la même transaction (mars OK, avril a jeté).
    expect(planningUpserts.map((u) => u['mois'])).toEqual([
      '2026-03',
      '2026-04',
    ]);
    // Seul mars a atteint son outbox ; avril a échoué avant → aucun event avril.
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      payload: { mois: '2026-03' },
    });
  });

  it('propage le 404 du contrat (garde unique) sans écrire aucun mois', async () => {
    const { db, transaction, planningUpserts, outboxEvents } = fakeDbSemaine({
      contratPresent: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.ecrireSemaine(CONTRAT_ID, '2026-W11', false, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    // La garde 404 est DANS la transaction : elle s'ouvre puis rollback, sans
    // aucune écriture (ni upsert planning ni outbox).
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(planningUpserts).toHaveLength(0);
    expect(outboxEvents).toHaveLength(0);
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
      enfantId: ENFANT_ID,
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      // Établissement obligatoire (P5) ; le faux `tx` valide son existence/foyer.
      etablissementId: ETAB_ID,
      // Le front envoie toujours les 7 jours (tableau vide = jour non gardé) ;
      // `z.record(<enum>, …)` de Zod v4 exige d'ailleurs les 7 clés.
      // Semaine type DOCUMENTÉE de Mia (doc 02 §7) : lundi, mercredi, vendredi
      // 8 h 30 → 17 h 00, soit 25 h 30/semaine. Elle ne portait ici que le lundi,
      // ce qui rendait la fixture **physiquement impossible** — 885,5 h annuelles
      // exigent au moins 105 lundis dans l'année. La garde de cohérence des
      // heures (`coherenceHeuresAnnuelles`) l'a mise au jour ; le plafond réel de
      // cette semaine sur 2026 est de 1326 h, la fixture est donc désormais tenable.
      semaineType: {
        LUNDI: [
          { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
        ],
        MARDI: [],
        MERCREDI: [
          { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
        ],
        JEUDI: [],
        VENDREDI: [
          { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
        ],
        SAMEDI: [],
        DIMANCHE: [],
      },
    });

    expect(vue).toMatchObject({ foyerId: FOYER_ID, mode: 'CRECHE_PSU' });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_CREE_V2_TYPE,
        payload: expect.objectContaining({
          foyerId: FOYER_ID,
          enfant: 'Mia',
          enfantId: ENFANT_ID,
        }),
      }),
    );
  });
});

/** DTO crèche valide de base (7 jours), surchargé pour les cas établissement. */
const DTO_CRECHE_BASE = {
  mode: 'CRECHE_PSU' as const,
  foyerId: FOYER_ID,
  enfant: 'Mia',
  enfantId: ENFANT_ID,
  valideDu: '2026-01-01',
  valideAu: '2026-12-31',
  heuresAnnuellesContractualisees: 885.5,
  nbMensualites: 7,
  // Semaine type DOCUMENTÉE de Mia (doc 02 §7) : lundi, mercredi, vendredi
  // 8 h 30 → 17 h 00 = 25 h 30/semaine, seule forme qui rende 885,5 h annuelles
  // physiquement atteignables sur l'année (plafond 1326 h). Cf. le commentaire de
  // la fixture ci-dessus : le lundi seul plafonnait à 442 h.
  semaineType: {
    LUNDI: [{ debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 }],
    MARDI: [],
    MERCREDI: [
      { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
    ],
    JEUDI: [],
    VENDREDI: [
      { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
    ],
    SAMEDI: [],
    DIMANCHE: [],
  },
};

/**
 * Faux `tx` pour `creerContrat` avec lien établissement : `select().from().where()`
 * renvoie l'établissement existant (ou `[]` pour simuler « hors foyer / inconnu »),
 * et chaque `insert().values()` est capturé. L'insert établissement (création à la
 * volée) expose `.returning()` renvoyant la ligne reflétant les valeurs insérées.
 */
function fakeCreerAvecEtab(
  etabExistant: boolean,
  etabActif = true,
): {
  db: Database;
  inserts: Record<string, unknown>[];
} {
  const inserts: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            etabExistant
              ? [{ id: ETAB_ID, foyerId: FOYER_ID, actif: etabActif }]
              : [],
          ),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        // Insert idempotent (Lot 3) : la création d'établissement (à la volée) et
        // celle du contrat passent toutes deux par `.onConflictDoNothing().returning()`
        // → ce fake sans état ne simule aucun conflit (chemin nominal, ligne renvoyée).
        const returning = (): Promise<Record<string, unknown>[]> =>
          Promise.resolve([
            {
              id: 'new-etab-id',
              foyerId: v['foyerId'],
              nom: v['nom'],
              emailService: v['emailService'] ?? null,
              preavisRegle: v['preavisRegle'] ?? null,
              types: v['types'] ?? [],
              actif: v['actif'] ?? true,
            },
          ]);
        return Object.assign(Promise.resolve(), {
          returning,
          onConflictDoNothing: () => ({ returning }),
        });
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as Database;
  return { db, inserts };
}

/** Retrouve l'insert outbox d'un type d'événement donné parmi les inserts capturés. */
function outboxDeType(
  inserts: Record<string, unknown>[],
  type: string,
): Record<string, unknown> | undefined {
  return inserts.find((i) => i['type'] === type);
}

describe('PlanificationService.creerContrat (lien établissement, P2)', () => {
  it('etablissementId existant : le valide (foyer) et le stocke + payload ContratCree', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    await service.creerContrat({
      ...DTO_CRECHE_BASE,
      etablissementId: ETAB_ID,
    });

    // L'insert contrat porte etablissementId ; pas de création d'établissement.
    const contratInsert = inserts.find((i) => i['mode'] === 'CRECHE_PSU');
    expect(contratInsert).toMatchObject({ etablissementId: ETAB_ID });
    expect(outboxDeType(inserts, ETABLISSEMENT_CREE_TYPE)).toBeUndefined();
    // L'événement ContratCree porte le lien.
    const cree = outboxDeType(inserts, CONTRAT_CREE_V2_TYPE);
    expect(cree?.['payload']).toMatchObject({ etablissementId: ETAB_ID });
  });

  it('etablissementId hors foyer / inconnu : 400, aucun contrat inséré', async () => {
    const { db, inserts } = fakeCreerAvecEtab(false);
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.creerContrat({ ...DTO_CRECHE_BASE, etablissementId: ETAB_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserts.find((i) => i['mode'] === 'CRECHE_PSU')).toBeUndefined();
  });

  it('etablissementId ARCHIVÉ : 409, aucun contrat inséré (archivage réel, Lot 3)', async () => {
    // Établissement existant/du bon foyer mais archivé (actif=false) → refus à la
    // création (il n'y a pas de lien « actuel » à tolérer).
    const { db, inserts } = fakeCreerAvecEtab(true, false);
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.creerContrat({ ...DTO_CRECHE_BASE, etablissementId: ETAB_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts.find((i) => i['mode'] === 'CRECHE_PSU')).toBeUndefined();
  });

  it('nouvelEtablissement : crée l’établissement (+EtablissementCree) ET le contrat dans la même transaction', async () => {
    const { db, inserts } = fakeCreerAvecEtab(false);
    const service = new PlanificationService(db, referentielVide);

    await service.creerContrat({
      ...DTO_CRECHE_BASE,
      nouvelEtablissement: { nom: 'Crèche du centre', types: ['CRECHE_PSU'] },
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // L'établissement est inséré (porte le foyer du contrat) + son événement émis.
    const etabInsert = inserts.find((i) => i['nom'] === 'Crèche du centre');
    expect(etabInsert).toMatchObject({ foyerId: FOYER_ID });
    const etabCree = outboxDeType(inserts, ETABLISSEMENT_CREE_TYPE);
    expect(etabCree?.['payload']).toMatchObject({
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
    });
    // Le contrat est rattaché à l'établissement fraîchement créé.
    const contratInsert = inserts.find((i) => i['mode'] === 'CRECHE_PSU');
    expect(contratInsert).toMatchObject({ etablissementId: 'new-etab-id' });
    const contratCree = outboxDeType(inserts, CONTRAT_CREE_V2_TYPE);
    expect(contratCree?.['payload']).toMatchObject({
      etablissementId: 'new-etab-id',
    });
  });
});

/**
 * Base factice **à état** (Lot 3 — C1 : idempotence de création), calquée sur le
 * `fakeBaseEnMemoire()` des tests d'intégration de projection (consumers). Un
 * magasin de lignes par table Drizzle, qui honore le sous-ensemble utilisé par
 * `creerContrat` : `select().from().where(eq | and(eq, eq))`,
 * `insert().values().onConflictDoNothing().returning()` (marqueur d'idempotence,
 * dédup par clé cible) et l'insert outbox « à plat » (`await ...values()`). Les
 * `eq(colonne, valeur)` (et leur conjonction `and`) sont évalués en lisant les
 * `queryChunks` Drizzle. La `transaction` **renvoie** la valeur du callback (la vue).
 */
type LigneMem = Record<string, unknown>;

function fakeBaseEnMemoire(seed?: { etablissements?: LigneMem[] }): {
  db: Database;
  lignesDe: (t: Table) => LigneMem[];
} {
  const magasin = new Map<Table, LigneMem[]>();
  const lignesDe = (table: Table): LigneMem[] => {
    let lignes = magasin.get(table);
    if (!lignes) {
      lignes = [];
      magasin.set(table, lignes);
    }
    return lignes;
  };
  for (const e of seed?.etablissements ?? []) {
    lignesDe(etablissement).push({ ...e });
  }
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
  /** Collecte colonnes + paramètres d'un `eq`/`and(eq, …)` (récursif sur les SQL imbriqués). */
  const collecter = (
    chunks: unknown[],
    cols: Column[],
    params: Param[],
  ): void => {
    for (const c of chunks) {
      if (c instanceof Column) {
        cols.push(c);
      } else if (c instanceof Param) {
        params.push(c);
      } else if (
        c &&
        typeof c === 'object' &&
        Array.isArray((c as { queryChunks?: unknown[] }).queryChunks)
      ) {
        collecter((c as { queryChunks: unknown[] }).queryChunks, cols, params);
      }
    }
  };
  /** Prédicat d'un `where(eq | and(eq, eq))` — conjonction d'égalités colonne=valeur. */
  const filtre = (table: Table, condition: unknown) => {
    const cols: Column[] = [];
    const params: Param[] = [];
    collecter(
      (condition as { queryChunks: unknown[] }).queryChunks,
      cols,
      params,
    );
    return (ligne: LigneMem): boolean =>
      cols.every((col, i) => ligne[cleDe(table, col)] === params[i]?.value);
  };
  const clefConflit = (
    table: Table,
    cibles: Column[],
    ligne: LigneMem,
  ): string => cibles.map((c) => String(ligne[cleDe(table, c)])).join('|');

  const operations = {
    select: () => ({
      from: (table: Table) => ({
        where: (condition: unknown) =>
          Promise.resolve(lignesDe(table).filter(filtre(table, condition))),
      }),
    }),
    insert: (table: Table) => ({
      values: (valeurs: LigneMem) => ({
        // Insert « à plat » (outbox) : `await ...values()` → insertion directe.
        then: (
          resoudre: (v: undefined) => void,
          rejeter: (e: unknown) => void,
        ) => {
          try {
            lignesDe(table).push({ ...valeurs });
            resoudre(undefined);
          } catch (e) {
            rejeter(e);
          }
        },
        // Insert idempotent : n'insère (et ne « renvoie ») que si la clé est nouvelle.
        onConflictDoNothing: (opts: { target: Column | Column[] }) => ({
          returning: () => {
            const cibles = Array.isArray(opts.target)
              ? opts.target
              : [opts.target];
            const clef = clefConflit(table, cibles, valeurs);
            const doublon = lignesDe(table).some(
              (l) => clefConflit(table, cibles, l) === clef,
            );
            if (doublon) {
              return Promise.resolve([]);
            }
            lignesDe(table).push({ ...valeurs });
            return Promise.resolve([{ id: valeurs['id'] }]);
          },
        }),
      }),
    }),
  };

  const db = {
    ...operations,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(operations),
  } as unknown as Database;

  return { db, lignesDe };
}

/** Établissement seedé (actif) rattachable par les contrats des tests d'idempotence. */
function etabSeed(overrides: Partial<Record<string, unknown>> = {}): LigneMem {
  return {
    id: ETAB_ID,
    foyerId: FOYER_ID,
    nom: 'Crèche du centre',
    actif: true,
    ...overrides,
  };
}

describe('PlanificationService.creerContrat (idempotence de création, Lot 3 — C1)', () => {
  it('double création (même id) → 1 seule ligne contrat, 1 seul ContratCree, même vue', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire({
      etablissements: [etabSeed()],
    });
    const service = new PlanificationService(db, referentielVide);
    const dto = {
      ...DTO_CRECHE_BASE,
      id: CONTRAT_ID,
      etablissementId: ETAB_ID,
    };

    const vue1 = await service.creerContrat(dto);
    const vue2 = await service.creerContrat(dto);

    // Une seule ligne contrat, un seul événement ContratCree (pas de double projection).
    expect(lignesDe(contrat)).toHaveLength(1);
    expect(
      lignesDe(outbox).filter((o) => o['type'] === CONTRAT_CREE_V2_TYPE),
    ).toHaveLength(1);
    // Les deux appels renvoient exactement la même vue (rejeu = relecture à l'identique).
    expect(vue2).toEqual(vue1);
    expect(vue1).toMatchObject({ id: CONTRAT_ID, foyerId: FOYER_ID });
  });

  it('resoudreEtablissement : nom déjà pris → contrat créé lié à l’établissement existant', async () => {
    // L'établissement « Crèche du centre » existe déjà dans le foyer ; la création
    // « à la volée » du même nom ne doit PAS échouer ni dupliquer : elle relie le
    // contrat à l'existant (au lieu du 23505 mensonger d'avant).
    const { db, lignesDe } = fakeBaseEnMemoire({
      etablissements: [etabSeed()],
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.creerContrat({
      ...DTO_CRECHE_BASE,
      id: CONTRAT_ID,
      nouvelEtablissement: { nom: 'Crèche du centre', types: ['CRECHE_PSU'] },
    });

    expect(vue.id).toBe(CONTRAT_ID);
    // Aucun doublon d'établissement ; le contrat pointe sur l'existant.
    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(lignesDe(contrat)[0]?.['etablissementId']).toBe(ETAB_ID);
    // Pas de nouvel EtablissementCree (l'établissement existait déjà) ; mais le
    // ContratCree est bien émis (le contrat, lui, est une vraie création).
    expect(
      lignesDe(outbox).filter((o) => o['type'] === ETABLISSEMENT_CREE_TYPE),
    ).toHaveLength(0);
    expect(
      lignesDe(outbox).filter((o) => o['type'] === CONTRAT_CREE_V2_TYPE),
    ).toHaveLength(1);
  });

  it('nouvelEtablissement inédit → crée l’établissement (+EtablissementCree) ET le contrat', async () => {
    // Foyer vierge : la création à la volée insère réellement l'établissement.
    const { db, lignesDe } = fakeBaseEnMemoire();
    const service = new PlanificationService(db, referentielVide);

    await service.creerContrat({
      ...DTO_CRECHE_BASE,
      id: CONTRAT_ID,
      nouvelEtablissement: { nom: 'Crèche neuve', types: ['CRECHE_PSU'] },
    });

    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(
      lignesDe(outbox).filter((o) => o['type'] === ETABLISSEMENT_CREE_TYPE),
    ).toHaveLength(1);
    expect(lignesDe(contrat)).toHaveLength(1);
  });
});

/** Semaine ABCM complète (les 7 jours — `z.record(enum, …)` exhaustif en Zod v4). */
const SEMAINE_ABCM_COMPLETE = {
  LUNDI: { cantine: true },
  MARDI: {},
  MERCREDI: {},
  JEUDI: {},
  VENDREDI: {},
  SAMEDI: {},
  DIMANCHE: {},
};

describe('PlanificationService (première inscription ABCM, lot 4a)', () => {
  /** DTO ABCM valide de base (cantine), rattaché à l'établissement existant. */
  const DTO_ABCM_BASE = {
    mode: 'CANTINE' as const,
    foyerId: FOYER_ID,
    enfant: 'Zoé',
    enfantId: ENFANT_ID,
    valideDu: '2026-09-01',
    valideAu: null,
    semaineAbcm: SEMAINE_ABCM_COMPLETE,
    etablissementId: ETAB_ID,
  };

  it('création ABCM cochée : colonne + payload ContratCree + vue avec premiereInscription: true', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.creerContrat({
      ...DTO_ABCM_BASE,
      premiereInscription: true,
    });

    expect(vue.premiereInscription).toBe(true);
    const contratInsert = inserts.find((i) => i['mode'] === 'CANTINE');
    expect(contratInsert).toMatchObject({ premiereInscription: true });
    const cree = outboxDeType(inserts, CONTRAT_CREE_V2_TYPE);
    expect(cree?.['payload']).toMatchObject({ premiereInscription: true });
  });

  it('création ABCM sans le champ : défaut false (colonne, événement, vue)', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.creerContrat(DTO_ABCM_BASE);

    expect(vue.premiereInscription).toBe(false);
    expect(inserts.find((i) => i['mode'] === 'CANTINE')).toMatchObject({
      premiereInscription: false,
    });
    expect(
      outboxDeType(inserts, CONTRAT_CREE_V2_TYPE)?.['payload'],
    ).toMatchObject({ premiereInscription: false });
  });

  it('création crèche : toujours false (le DTO crèche n’expose pas le champ)', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.creerContrat({
      ...DTO_CRECHE_BASE,
      etablissementId: ETAB_ID,
    });

    expect(vue.premiereInscription).toBe(false);
    expect(
      outboxDeType(inserts, CONTRAT_CREE_V2_TYPE)?.['payload'],
    ).toMatchObject({ premiereInscription: false });
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

/** Ligne `contrat_version` de test (crèche par défaut). */
function versionRow(
  overrides: Partial<ContratVersionRow> = {},
): ContratVersionRow {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    contratId: CONTRAT_ID,
    dateEffet: '2026-01-01',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: {
      LUNDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
      ],
    },
    semaineAbcm: null,
    saisiLe: new Date('2026-01-01T00:00:00Z'),
    motif: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Faux `db` **en mémoire** pour le versionnement (SFD 30 lot 4) : un magasin par
 * table (contrat / contrat_version / correction_journal / outbox / planning_mois),
 * `select`/`insert`/`update`/`delete` opérant dessus (les `where` sont ignorés — un
 * seul contrat par test). Permet d'observer que l'avenant/la correction insèrent une
 * version, rafraîchissent la projection de `contrat`, journalisent, émettent
 * `ContratModifie` et **ne suppriment jamais** les `planning_mois`.
 */
function fakeDbVersionnee(seed: {
  contrat?: ContratRow;
  versions?: ContratVersionRow[];
  plannings?: Record<string, unknown>[];
}): {
  db: Database;
  store: {
    contrat: Record<string, unknown>[];
    contratVersion: Record<string, unknown>[];
    correctionJournal: Record<string, unknown>[];
    outbox: Record<string, unknown>[];
    planningMois: Record<string, unknown>[];
  };
  supprime: Table[];
} {
  const store = {
    contrat: (seed.contrat ? [{ ...seed.contrat }] : []) as Record<
      string,
      unknown
    >[],
    contratVersion: (seed.versions ?? []).map((v) => ({ ...v })),
    correctionJournal: [] as Record<string, unknown>[],
    outbox: [] as Record<string, unknown>[],
    planningMois: (seed.plannings ?? []).map((p) => ({ ...p })),
    // Établissement rattaché aux contrats seedés (résolution du lien au chemin
    // de compat `corrigerVersionCourante`).
    etablissement: [{ id: ETAB_ID, foyerId: FOYER_ID, actif: true }] as Record<
      string,
      unknown
    >[],
  };
  const supprime: Table[] = [];
  const rowsFor = (t: Table): Record<string, unknown>[] => {
    if (t === contrat) return store.contrat;
    if (t === contratVersion) return store.contratVersion;
    if (t === correctionJournal) return store.correctionJournal;
    if (t === outbox) return store.outbox;
    if (t === etablissement) return store.etablissement;
    return store.planningMois;
  };
  const ops = {
    select: () => ({
      from: (t: Table) => {
        const rows = rowsFor(t);
        return {
          where: () =>
            Object.assign(Promise.resolve(rows), {
              orderBy: () => Promise.resolve(rows),
            }),
          orderBy: () => Promise.resolve(rows),
        };
      },
    }),
    insert: (t: Table) => ({
      values: (v: Record<string, unknown>) => ({
        // Insert « à plat » (outbox, correction_journal, version initiale).
        then: (
          resoudre: (u: undefined) => void,
          rejeter: (e: unknown) => void,
        ) => {
          try {
            rowsFor(t).push({ ...v });
            resoudre(undefined);
          } catch (e) {
            rejeter(e);
          }
        },
        // Insert avenant : dédup (contrat_id, date_effet) → [] si conflit (409).
        onConflictDoNothing: () => ({
          returning: () => {
            const doublon = store.contratVersion.some(
              (x) =>
                x.contratId === v['contratId'] &&
                x.dateEffet === v['dateEffet'],
            );
            if (doublon) {
              return Promise.resolve([]);
            }
            rowsFor(t).push({ ...v });
            return Promise.resolve([{ id: v['id'] }]);
          },
        }),
      }),
    }),
    update: (t: Table) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          for (const row of rowsFor(t)) {
            Object.assign(row, vals);
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: (t: Table) => ({
      where: () => {
        supprime.push(t);
        rowsFor(t).length = 0;
        return Promise.resolve();
      },
    }),
  };
  const db = {
    ...ops,
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(ops),
    ),
  } as unknown as Database;
  return { db, store, supprime };
}

/** Semaine type crèche complète (7 jours, comme l'exige `z.record` exhaustif). */
function semaine7(lundi: {
  debutHeures: number;
  debutMinutes: number;
  finHeures: number;
  finMinutes: number;
}): Record<
  string,
  {
    debutHeures: number;
    debutMinutes: number;
    finHeures: number;
    finMinutes: number;
  }[]
> {
  return {
    LUNDI: [lundi],
    MARDI: [],
    MERCREDI: [],
    JEUDI: [],
    VENDREDI: [],
    SAMEDI: [],
    DIMANCHE: [],
  };
}

const AVENANT_CRECHE: CreerAvenantDto = {
  mode: 'CRECHE_PSU',
  dateEffet: '2026-09-01',
  heuresAnnuellesContractualisees: 700,
  nbMensualites: 7,
  semaineType: semaine7({
    debutHeures: 8,
    debutMinutes: 30,
    finHeures: 12,
    finMinutes: 30,
  }),
};

describe('PlanificationService.creerAvenant (SFD 30 lot 4)', () => {
  it('insère une version, rafraîchit la projection, émet ContratModifie et PRÉSERVE les planning_mois', async () => {
    const { db, store, supprime } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [versionRow()],
      plannings: [{ contratId: CONTRAT_ID, mois: '2026-03', saisie: {} }],
    });
    const service = new PlanificationService(db, referentielVide);

    await service.creerAvenant(CONTRAT_ID, AVENANT_CRECHE);

    // La version est ajoutée (2 au total), sans toucher aux plannings saisis.
    expect(store.contratVersion).toHaveLength(2);
    expect(store.planningMois).toHaveLength(1); // survivent à l'avenant
    expect(supprime).not.toContain(planningMois); // JAMAIS de cascade-delete
    // Projection rafraîchie : la version du 2026-09-01 est courante (après auj.
    // dans les tests figés) OU la précédente — dans tous les cas une écriture a eu
    // lieu et un ContratModifie est émis.
    expect(
      store.outbox.some((o) => o['type'] === CONTRAT_MODIFIE_V2_TYPE),
    ).toBe(true);
  });

  it('refuse un mode différent (H6 : l’identité n’est pas versionnée) → 400', async () => {
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [versionRow()],
    });
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.creerAvenant(CONTRAT_ID, {
        mode: 'CANTINE',
        dateEffet: '2026-09-01',
        semaineAbcm: SEMAINE_ABCM_COMPLETE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une date d’effet antérieure au début du contrat → 400', async () => {
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche({ valideDu: '2026-01-01' }),
      versions: [versionRow()],
    });
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.creerAvenant(CONTRAT_ID, {
        ...AVENANT_CRECHE,
        dateEffet: '2025-12-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une seconde version à la même date d’effet → 409', async () => {
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [versionRow({ dateEffet: '2026-09-01' })],
    });
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.creerAvenant(CONTRAT_ID, AVENANT_CRECHE),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lève NotFoundException si le contrat est introuvable', async () => {
    const { db } = fakeDbVersionnee({ versions: [] });
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.creerAvenant(CONTRAT_ID, AVENANT_CRECHE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlanificationService.corrigerVersion / corrigerVersionCourante', () => {
  it('corrige une version : écrase, journalise (correction_journal), émet, ne supprime rien', async () => {
    const version = versionRow({ dateEffet: '2026-01-01' });
    const { db, store, supprime } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [version],
      plannings: [{ contratId: CONTRAT_ID, mois: '2026-03', saisie: {} }],
    });
    const service = new PlanificationService(db, referentielVide);

    const dto: CorrigerVersionDto = {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 600,
      nbMensualites: 7,
      semaineType: semaine7({
        debutHeures: 9,
        debutMinutes: 0,
        finHeures: 16,
        finMinutes: 0,
      }),
      motif: 'erreur de saisie',
    };
    await service.corrigerVersion(CONTRAT_ID, version.id, dto);

    expect(store.correctionJournal).toHaveLength(1);
    expect(store.correctionJournal[0]).toMatchObject({
      motif: 'erreur de saisie',
    });
    expect(store.contratVersion[0]).toMatchObject({
      heuresAnnuellesContractualisees: 600,
    });
    expect(store.planningMois).toHaveLength(1); // survivent
    expect(supprime).not.toContain(planningMois);
    expect(
      store.outbox.some((o) => o['type'] === CONTRAT_MODIFIE_V2_TYPE),
    ).toBe(true);
  });

  it('lève NotFoundException si la version est introuvable', async () => {
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [],
    });
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.corrigerVersion(
        CONTRAT_ID,
        '10000000-0000-4000-8000-000000000009',
        {
          mode: 'CRECHE_PSU',
          heuresAnnuellesContractualisees: 600,
          nbMensualites: 7,
          semaineType: semaine7({
            debutHeures: 9,
            debutMinutes: 0,
            finHeures: 16,
            finMinutes: 0,
          }),
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('corrigerVersionCourante : applique le corps complet à la version courante, PRÉSERVE les plannings', async () => {
    const { db, store, supprime } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [versionRow({ dateEffet: '2026-01-01' })],
      plannings: [{ contratId: CONTRAT_ID, mois: '2026-03', saisie: {} }],
    });
    const service = new PlanificationService(db, referentielVide);

    const corps: ModifierContratDto = {
      mode: 'CRECHE_PSU',
      foyerId: FOYER_ID,
      enfant: 'Mia',
      enfantId: ENFANT_ID,
      etablissementId: ETAB_ID,
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
      heuresAnnuellesContractualisees: 500,
      nbMensualites: 7,
      semaineType: {
        LUNDI: [
          { debutHeures: 8, debutMinutes: 0, finHeures: 12, finMinutes: 0 },
        ],
        MARDI: [],
        MERCREDI: [],
        JEUDI: [],
        VENDREDI: [],
        SAMEDI: [],
        DIMANCHE: [],
      },
    };
    await service.corrigerVersionCourante(CONTRAT_ID, corps);

    expect(store.contratVersion[0]).toMatchObject({
      heuresAnnuellesContractualisees: 500,
    });
    expect(store.correctionJournal).toHaveLength(1);
    expect(store.planningMois).toHaveLength(1);
    expect(supprime).not.toContain(planningMois);
  });

  it('corrigerVersionCourante refuse un mode différent (H6) → 400', async () => {
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche(),
      versions: [versionRow()],
    });
    const service = new PlanificationService(db, referentielVide);
    await expect(
      service.corrigerVersionCourante(CONTRAT_ID, {
        mode: 'CANTINE',
        foyerId: FOYER_ID,
        enfant: 'Zoé',
        enfantId: ENFANT_ID,
        etablissementId: ETAB_ID,
        valideDu: '2026-01-01',
        valideAu: null,
        semaineAbcm: SEMAINE_ABCM_COMPLETE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PlanificationService (versionnement ABCM + cas limites)', () => {
  it('avenant ABCM : les paramètres versionnés sont la semaine ABCM seule', async () => {
    const contratCantine = ligneAbcm('CANTINE', { LUNDI: { cantine: true } });
    const { db, store } = fakeDbVersionnee({
      contrat: contratCantine,
      versions: [
        versionRow({
          dateEffet: '2026-01-01',
          heuresAnnuellesContractualisees: null,
          nbMensualites: null,
          semaineType: null,
          semaineAbcm: { LUNDI: { cantine: true } },
        }),
      ],
    });
    const service = new PlanificationService(db, referentielVide);

    await service.creerAvenant(CONTRAT_ID, {
      mode: 'CANTINE',
      dateEffet: '2026-09-01',
      semaineAbcm: SEMAINE_ABCM_COMPLETE,
    });

    expect(store.contratVersion).toHaveLength(2);
    const nouvelle = store.contratVersion.find(
      (v) => v['dateEffet'] === '2026-09-01',
    );
    expect(nouvelle).toMatchObject({
      heuresAnnuellesContractualisees: null,
      nbMensualites: null,
      semaineType: null,
    });
    expect(nouvelle?.['semaineAbcm']).toBeTruthy();
  });

  it('versions toutes futures : la projection retombe sur la plus proche (contrat pas commencé)', async () => {
    const { db, store } = fakeDbVersionnee({
      contrat: ligneCreche({ valideDu: '2099-01-01', valideAu: null }),
      versions: [versionRow({ dateEffet: '2099-01-01' })],
    });
    const service = new PlanificationService(db, referentielVide);

    await service.creerAvenant(CONTRAT_ID, {
      ...AVENANT_CRECHE,
      dateEffet: '2099-06-01',
    });

    // Aucune version applicable aujourd'hui → la projection reflète la version
    // la plus proche (2099-01-01), pas un état vide.
    expect(store.contrat[0]).toMatchObject({
      heuresAnnuellesContractualisees: 885.5,
    });
  });

  it('prestations ABCM versionnées : segments cantine sommés sur le mois', async () => {
    const versions = [
      versionRow({
        dateEffet: '2026-01-01',
        heuresAnnuellesContractualisees: null,
        nbMensualites: null,
        semaineType: null,
        semaineAbcm: { LUNDI: { cantine: true } },
      }),
      versionRow({
        id: '10000000-0000-4000-8000-000000000004',
        dateEffet: '2026-10-15',
        heuresAnnuellesContractualisees: null,
        nbMensualites: null,
        semaineType: null,
        semaineAbcm: {},
      }),
    ];
    const db = fakeDbLecture(
      [ligneAbcm('CANTINE', { LUNDI: { cantine: true } })],
      [],
      versions,
    );
    const service = new PlanificationService(db, referentielVide);

    const resultat = await service.prestationsMois(CONTRAT_ID, MOIS, false);
    const presta = resultat.prestations[0] as PrestationsMoisCantine;
    // Lundis 05 et 12 (ancienne semaine) ; 19 et 26 retirés par l'avenant.
    expect(presta.nbJours).toBe(2);
  });
});

describe('PlanificationService.listerVersions / apercuImpactVersion', () => {
  it('historique : versions de la plus récente à la plus ancienne, périodes dérivées', async () => {
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche({ valideDu: '2026-01-01', valideAu: '2026-12-31' }),
      versions: [
        versionRow({
          id: '10000000-0000-4000-8000-00000000000a',
          dateEffet: '2026-01-01',
        }),
        versionRow({
          id: '10000000-0000-4000-8000-00000000000b',
          dateEffet: '2026-09-01',
        }),
      ],
    });
    const service = new PlanificationService(db, referentielVide);

    const historique = await service.listerVersions(CONTRAT_ID);
    expect(historique.map((v) => v.dateEffet)).toEqual([
      '2026-09-01',
      '2026-01-01',
    ]);
    // La 1ʳᵉ version est close la veille de la 2ᵉ (fin dérivée) ; la 2ᵉ est ouverte.
    const premiere = historique.find((v) => v.dateEffet === '2026-01-01');
    expect(premiere?.au).toBe('2026-08-31');
    const seconde = historique.find((v) => v.dateEffet === '2026-09-01');
    expect(seconde?.au).toBeNull();
  });

  it('aperçu d’impact d’une version ouverte sur contrat ouvert : plafonné à son mois de départ', async () => {
    // Version [2026-12-15, ouverte], contrat sans fin : l'aperçu ne projette pas
    // indéfiniment — il liste le mois de départ (décembre, franchit l'année via
    // moisEntre pour un éventuel plafond ultérieur).
    const version = versionRow({
      id: '10000000-0000-4000-8000-00000000000e',
      dateEffet: '2026-12-15',
    });
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche({ valideDu: '2026-01-01', valideAu: null }),
      versions: [
        versionRow({
          id: '10000000-0000-4000-8000-00000000000f',
          dateEffet: '2026-01-01',
        }),
        version,
      ],
    });
    const service = new PlanificationService(db, referentielVide);

    const impact = await service.apercuImpactVersion(CONTRAT_ID, version.id);
    expect(impact.moisCouverts).toEqual(['2026-12']);
  });

  it('aperçu d’impact à cheval sur l’année : décembre → janvier (bascule moisEntre)', async () => {
    const version = versionRow({
      id: '10000000-0000-4000-8000-000000000010',
      dateEffet: '2026-12-01',
    });
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche({ valideDu: '2026-01-01', valideAu: '2027-01-31' }),
      versions: [
        versionRow({
          id: '10000000-0000-4000-8000-000000000011',
          dateEffet: '2026-01-01',
        }),
        version,
      ],
    });
    const service = new PlanificationService(db, referentielVide);

    const impact = await service.apercuImpactVersion(CONTRAT_ID, version.id);
    // Version ouverte plafonnée à valideAu 2027-01-31 → décembre puis janvier.
    expect(impact.moisCouverts).toEqual(['2026-12', '2027-01']);
  });

  it('aperçu d’impact : liste les mois couverts par la version (plafonné à la vie du contrat)', async () => {
    const version = versionRow({
      id: '10000000-0000-4000-8000-00000000000c',
      dateEffet: '2026-06-01',
    });
    const { db } = fakeDbVersionnee({
      contrat: ligneCreche({ valideDu: '2026-01-01', valideAu: '2026-07-31' }),
      versions: [
        versionRow({
          id: '10000000-0000-4000-8000-00000000000d',
          dateEffet: '2026-01-01',
        }),
        version,
      ],
    });
    const service = new PlanificationService(db, referentielVide);

    const impact = await service.apercuImpactVersion(CONTRAT_ID, version.id);
    // Version [2026-06-01, ouverte] plafonnée à valideAu 2026-07-31 → juin, juillet.
    expect(impact.moisCouverts).toEqual(['2026-06', '2026-07']);
  });
});

/**
 * Faux `db` transactionnel pour `rattacherEtablissement` : deux `select` successifs
 * (1ᵉʳ = contrat, 2ᵉ = établissement). `contratLigne` pilote le garde 404 ;
 * `etabPresent` pilote l'appartenance au foyer (2ᵉ select vide = inconnu/hors foyer).
 * On espionne `update`, `delete` (doit rester non appelé : non destructif) et
 * l'`insert` outbox. La transaction **renvoie** la valeur du callback (la vue).
 */
function fakeDbRattacher(options: {
  contratLigne: ContratRow | null;
  etabPresent: boolean;
  etabActif?: boolean;
}): {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  deleteWhere: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
} {
  const updateSet = vi.fn(() => ({ where: () => Promise.resolve() }));
  const deleteWhere = vi.fn(() => Promise.resolve());
  const insertValues = vi.fn(() => Promise.resolve());
  let selectCall = 0;
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          selectCall += 1;
          if (selectCall === 1) {
            return Promise.resolve(
              options.contratLigne ? [options.contratLigne] : [],
            );
          }
          return Promise.resolve(
            options.etabPresent
              ? [
                  {
                    id: ETAB_ID,
                    foyerId: FOYER_ID,
                    actif: options.etabActif ?? true,
                  },
                ]
              : [],
          );
        },
      }),
    }),
    update: () => ({ set: updateSet }),
    delete: () => ({ where: deleteWhere }),
    insert: () => ({ values: insertValues }),
  };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { transaction } as unknown as Database;
  return { db, transaction, updateSet, deleteWhere, insertValues };
}

describe('PlanificationService.rattacherEtablissement (back-fill P5)', () => {
  it('rattache un contrat vers un autre établissement : update du seul etablissement_id + outbox ContratModifie, AUCUNE suppression de planning', async () => {
    const { db, updateSet, deleteWhere, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ etablissementId: AUTRE_ETAB_ID }),
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.rattacherEtablissement(CONTRAT_ID, ETAB_ID);

    expect(vue).toMatchObject({ id: CONTRAT_ID, foyerId: FOYER_ID });
    // Met à jour le lien sans cascade : pas de delete des plannings (non destructif).
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(deleteWhere).not.toHaveBeenCalled();
    // L'événement ContratModifie porte le lien (projection notifications).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_MODIFIE_TYPE,
        payload: expect.objectContaining({
          contratId: CONTRAT_ID,
          mode: 'CRECHE_PSU',
          etablissementId: ETAB_ID,
        }),
      }),
    );
  });

  it('idempotent : contrat déjà rattaché à cet établissement → no-op (aucune écriture, aucun événement)', async () => {
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ etablissementId: ETAB_ID }),
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.rattacherEtablissement(CONTRAT_ID, ETAB_ID);

    expect(vue).toMatchObject({ id: CONTRAT_ID });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('400 si l’établissement est inconnu ou hors du foyer du contrat : rien n’est écrit', async () => {
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ etablissementId: AUTRE_ETAB_ID }),
      etabPresent: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.rattacherEtablissement(CONTRAT_ID, ETAB_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('409 si l’établissement cible est ARCHIVÉ (changement de lien) : rien n’est écrit', async () => {
    // Le contrat pointe sur un AUTRE établissement → repointer vers un archivé est un
    // changement, donc refusé (l'idempotence « lien inchangé » ne s'applique pas ici).
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ etablissementId: AUTRE_ETAB_ID }),
      etabPresent: true,
      etabActif: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.rattacherEtablissement(CONTRAT_ID, ETAB_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('404 si le contrat est introuvable : rien n’est écrit', async () => {
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: null,
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.rattacherEtablissement(CONTRAT_ID, ETAB_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('PlanificationService.rattacherEnfant (back-fill enfant_id)', () => {
  it('rattache un contrat orphelin : update du seul enfant_id + outbox ContratModifie, AUCUNE suppression de planning', async () => {
    const { db, updateSet, deleteWhere, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ enfantId: null }),
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.rattacherEnfant(CONTRAT_ID, ENFANT_ID);

    expect(vue).toMatchObject({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfantId: ENFANT_ID,
    });
    // Met à jour le lien sans cascade : pas de delete des plannings (non destructif).
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ enfantId: ENFANT_ID }),
    );
    expect(deleteWhere).not.toHaveBeenCalled();
    // L'événement ContratModifie porte le lien (prénom dénormalisé inchangé).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_MODIFIE_TYPE,
        payload: expect.objectContaining({
          contratId: CONTRAT_ID,
          enfant: 'Mia',
          enfantId: ENFANT_ID,
        }),
      }),
    );
  });

  it('reconduit premiereInscription dans le ContratModifie ré-émis (rattachement chirurgical)', async () => {
    // Contrat ABCM première inscription : le geste chirurgical ne touche QUE le
    // lien enfant — le champ doit voyager tel quel (sinon il « clignote »).
    const { db, insertValues } = fakeDbRattacher({
      contratLigne: {
        ...ligneAbcm('CANTINE', {}),
        enfantId: null,
        premiereInscription: true,
      },
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.rattacherEnfant(CONTRAT_ID, ENFANT_ID);

    expect(vue.premiereInscription).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_MODIFIE_TYPE,
        payload: expect.objectContaining({ premiereInscription: true }),
      }),
    );
  });

  it('re-pointe un contrat déjà rattaché vers un autre enfant (correction manuelle)', async () => {
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ enfantId: AUTRE_ENFANT_ID }),
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.rattacherEnfant(CONTRAT_ID, ENFANT_ID);

    expect(vue).toMatchObject({ enfantId: ENFANT_ID });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it('idempotent : contrat déjà rattaché à cet enfant → no-op (aucune écriture, aucun événement)', async () => {
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: ligneCreche({ enfantId: ENFANT_ID }),
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.rattacherEnfant(CONTRAT_ID, ENFANT_ID);

    expect(vue).toMatchObject({ id: CONTRAT_ID, enfantId: ENFANT_ID });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('404 si le contrat est introuvable : rien n’est écrit', async () => {
    const { db, updateSet, insertValues } = fakeDbRattacher({
      contratLigne: null,
      etabPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.rattacherEnfant(CONTRAT_ID, ENFANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

/**
 * **Non-régression du défaut de production du 2026-08-29.** Un contrat de rentrée
 * a été créé depuis un compte parent avec `1607` h annuelles — la valeur proposée
 * par défaut du formulaire, qui est la durée légale annuelle du *travail* en
 * France — pour une semaine type de 27 h. Soit 59,5 semaines de garde, quand une
 * année en compte 52 ; la mensualisation surfacturait d'environ 27 %.
 *
 * Rien, ni côté formulaire ni côté service, ne confrontait la valeur à la semaine
 * type saisie juste à côté. La garde le fait maintenant **au bord d'écriture**,
 * et refuse uniquement l'impossible (cf. `heures-contrat.ts`).
 */
describe('PlanificationService — cohérence des heures annuelles', () => {
  /** Les valeurs EXACTES du contrat fautif en production. */
  const SEMAINE_RENTREE = {
    LUNDI: [
      { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 30 },
    ],
    MARDI: [
      { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 30 },
    ],
    MERCREDI: [],
    JEUDI: [
      { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 30 },
    ],
    VENDREDI: [],
    SAMEDI: [],
    DIMANCHE: [],
  };
  const DTO_RENTREE = {
    ...DTO_CRECHE_BASE,
    enfant: 'Lisa',
    valideDu: '2026-09-01',
    valideAu: '2027-07-23',
    nbMensualites: 12,
    semaineType: SEMAINE_RENTREE,
    etablissementId: ETAB_ID,
  };

  it('REFUSE 1607 h pour 27 h/semaine, et n’insère aucun contrat', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.creerContrat({
        ...DTO_RENTREE,
        heuresAnnuellesContractualisees: 1607,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserts.find((i) => i['mode'] === 'CRECHE_PSU')).toBeUndefined();
  });

  it('rattache le refus au champ, avec un message sans jargon ni identifiant', async () => {
    const { db } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.creerContrat({
        ...DTO_RENTREE,
        heuresAnnuellesContractualisees: 1607,
      }),
    ).rejects.toThrow();

    // Le corps du 400 porte l'erreur RATTACHÉE au champ : c'est ce qui permet au
    // formulaire de la poser sous la bonne ligne plutôt qu'en bandeau générique.
    let capturee: unknown;
    try {
      await service.creerContrat({
        ...DTO_RENTREE,
        heuresAnnuellesContractualisees: 1607,
      });
    } catch (e) {
      capturee = (e as BadRequestException).getResponse();
    }
    expect(capturee).toMatchObject({
      statusCode: 400,
      message: [
        {
          champ: 'heuresAnnuellesContractualisees',
          message:
            'Avec 27 h par semaine, ce contrat représente au maximum 1260 h sur ' +
            'sa période, même sans aucune fermeture. Vous avez saisi 1607 h.',
        },
      ],
    });
  });

  it('ACCEPTE la même saisie ramenée sous le plafond (1260 h)', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    await service.creerContrat({
      ...DTO_RENTREE,
      heuresAnnuellesContractualisees: 1260,
    });
    expect(inserts.find((i) => i['mode'] === 'CRECHE_PSU')).toBeDefined();
  });

  it('n’a aucun avis sur un contrat SANS TERME (aucun plafond n’existe)', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    await service.creerContrat({
      ...DTO_RENTREE,
      valideAu: null,
      heuresAnnuellesContractualisees: 1607,
    });
    expect(inserts.find((i) => i['mode'] === 'CRECHE_PSU')).toBeDefined();
  });
});
