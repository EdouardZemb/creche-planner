import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
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
        return Object.assign(Promise.resolve(), {
          returning: () =>
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
            ]),
        });
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => {
      await cb(tx);
    }),
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
    const cree = outboxDeType(inserts, CONTRAT_CREE_TYPE);
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
    const contratCree = outboxDeType(inserts, CONTRAT_CREE_TYPE);
    expect(contratCree?.['payload']).toMatchObject({
      etablissementId: 'new-etab-id',
    });
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
    const cree = outboxDeType(inserts, CONTRAT_CREE_TYPE);
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
    expect(outboxDeType(inserts, CONTRAT_CREE_TYPE)?.['payload']).toMatchObject(
      { premiereInscription: false },
    );
  });

  it('création crèche : toujours false (le DTO crèche n’expose pas le champ)', async () => {
    const { db, inserts } = fakeCreerAvecEtab(true);
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.creerContrat({
      ...DTO_CRECHE_BASE,
      etablissementId: ETAB_ID,
    });

    expect(vue.premiereInscription).toBe(false);
    expect(outboxDeType(inserts, CONTRAT_CREE_TYPE)?.['payload']).toMatchObject(
      { premiereInscription: false },
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
  enfantId: ENFANT_ID,
  // Établissement obligatoire (P5) ; le faux `tx` valide son existence/foyer.
  etablissementId: ETAB_ID,
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

  it('édition ABCM cochée → update + ContratModifie avec premiereInscription: true', async () => {
    const { db, updateSet, insertValues } = fakeDbModif({
      contratPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.modifierContrat(CONTRAT_ID, {
      mode: 'CANTINE',
      foyerId: FOYER_ID,
      enfant: 'Zoé',
      enfantId: ENFANT_ID,
      etablissementId: ETAB_ID,
      valideDu: '2026-09-01',
      valideAu: null,
      semaineAbcm: SEMAINE_ABCM_COMPLETE,
      premiereInscription: true,
    });

    expect(vue.premiereInscription).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ premiereInscription: true }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_MODIFIE_TYPE,
        payload: expect.objectContaining({ premiereInscription: true }),
      }),
    );
  });

  it('édition ABCM décochée (champ absent) → premiereInscription remis à false', async () => {
    const { db, updateSet, insertValues } = fakeDbModif({
      contratPresent: true,
    });
    const service = new PlanificationService(db, referentielVide);

    const vue = await service.modifierContrat(CONTRAT_ID, {
      mode: 'CANTINE',
      foyerId: FOYER_ID,
      enfant: 'Zoé',
      enfantId: ENFANT_ID,
      etablissementId: ETAB_ID,
      valideDu: '2026-09-01',
      valideAu: null,
      semaineAbcm: SEMAINE_ABCM_COMPLETE,
    });

    expect(vue.premiereInscription).toBe(false);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ premiereInscription: false }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CONTRAT_MODIFIE_TYPE,
        payload: expect.objectContaining({ premiereInscription: false }),
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

/**
 * Faux `db` transactionnel pour `modifierContrat` avec **résolution d'établissement**
 * (Lot 3) : deux `select` successifs — 1ᵉʳ = contrat actuel (porte le lien courant,
 * `etablissementActuel`), 2ᵉ = établissement CIBLE résolu (`etabActif`). Permet de
 * vérifier la tolérance « lien inchangé » vs le rejet d'un **changement** vers un archivé.
 */
function fakeDbModifAvecEtab(options: {
  etablissementActuel: string;
  etabActif: boolean;
}): {
  db: Database;
  updateSet: ReturnType<typeof vi.fn>;
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
            return Promise.resolve([
              ligneCreche({ etablissementId: options.etablissementActuel }),
            ]);
          }
          return Promise.resolve([
            { id: ETAB_ID, foyerId: FOYER_ID, actif: options.etabActif },
          ]);
        },
      }),
    }),
    update: () => ({ set: updateSet }),
    delete: () => ({ where: deleteWhere }),
    insert: () => ({ values: insertValues }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => {
      await cb(tx);
    }),
  } as unknown as Database;
  return { db, updateSet, insertValues };
}

describe('PlanificationService.modifierContrat (archivage réel, Lot 3)', () => {
  it('tolère un archivé INCHANGÉ : le contrat pointait déjà dessus → update OK (édition d’autres champs)', async () => {
    // Lien actuel = ETAB_ID (archivé) ; DTO_MODIF_VALIDE re-pointe sur ETAB_ID (même) :
    // lien inchangé → toléré malgré l'archivage (on ne casse pas un contrat existant).
    const { db, updateSet, insertValues } = fakeDbModifAvecEtab({
      etablissementActuel: ETAB_ID,
      etabActif: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await service.modifierContrat(CONTRAT_ID, DTO_MODIF_VALIDE);

    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ etablissementId: ETAB_ID }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: CONTRAT_MODIFIE_TYPE }),
    );
  });

  it('refuse un CHANGEMENT vers un archivé (409) : le contrat pointait ailleurs → rien n’est écrit', async () => {
    // Lien actuel = AUTRE_ETAB_ID ; DTO_MODIF_VALIDE pointe sur ETAB_ID (archivé) :
    // c'est un changement vers un archivé → refusé, aucune écriture.
    const { db, updateSet, insertValues } = fakeDbModifAvecEtab({
      etablissementActuel: AUTRE_ETAB_ID,
      etabActif: false,
    });
    const service = new PlanificationService(db, referentielVide);

    await expect(
      service.modifierContrat(CONTRAT_ID, DTO_MODIF_VALIDE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
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
