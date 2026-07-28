import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { CoutService } from './cout.service.js';
import type { Database } from '../database/database.types.js';
import {
  baremePsu,
  contrat,
  foyer,
  foyerVersion,
  grilleTarifaire,
} from '../database/schema.js';
import type { FoyerClient } from '../fallback/foyer.client.js';
import type { PlanificationClient } from '../fallback/planification.client.js';
import type { ReferentielClient } from '../fallback/referentiel.client.js';

/**
 * Tests de la **sémantique d'erreur explicite** du service de coût (plus jamais
 * de montant faux silencieux) : un repli synchrone qui ÉCHOUE (foyer, prestations
 * ou grille injoignables) répond 503 — jamais un « foyer neutre » ni un total
 * sous-estimé — tandis qu'un repli qui RÉUSSIT vide (contrat sans prestation ce
 * mois) reste une omission légitime. Depuis SFD 30 (D1), la **grille est résolue
 * à date** depuis le read-model `grille_tarifaire` (repli REST sinon) : la CA1/CA2
 * « juin ancienne grille / septembre nouvelle » est couverte ici bout-en-bout.
 */

const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '33333333-3333-4333-8333-333333333333';

/** Foyer de référence projeté (T3, doc 02 §0). */
const FOYER_ROW = {
  id: FOYER_ID,
  ressourcesMensuellesCentimes: 671692,
  rfrCentimes: 7270500,
  tranche: 3,
  nbParts: '2',
  nbEnfantsACharge: 2,
  eventId: null,
  occurredAt: null,
  updatedAt: new Date(),
};

const CONTRAT_ROW = {
  id: CONTRAT_ID,
  foyerId: FOYER_ID,
  enfant: 'Mia',
  mode: 'CANTINE',
  premiereInscription: false,
  valideDu: '2026-09-01',
  updatedAt: new Date(),
};

/** Projection `prestation_mois` d'octobre (16 jours de cantine, CT-10). */
const PRESTATION_ROW = {
  id: '44444444-4444-4444-8444-444444444444',
  contratId: CONTRAT_ID,
  foyerId: FOYER_ID,
  enfant: 'Mia',
  mode: 'CANTINE',
  mois: '2026-10',
  simule: false,
  prestations: { mode: 'CANTINE', nbJours: 16 },
  eventId: null,
  occurredAt: null,
  updatedAt: new Date(),
};

/** Grille cantine T3 projetée (montants v2), valide en continu depuis 2026. */
function grilleCantine(
  overrides: {
    valideDu?: string;
    valideAu?: string | null;
    cantineTotalCentimes?: number;
  } = {},
): Record<string, unknown> {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    mode: 'CANTINE',
    tranche: 3,
    valideDu: overrides.valideDu ?? '2026-01-01',
    valideAu: overrides.valideAu ?? null,
    parametres: {
      cantineTotalCentimes: overrides.cantineTotalCentimes ?? 1268,
      cantinePartGardeCentimes: 801,
    },
    eventId: null,
    occurredAt: null,
    updatedAt: new Date(),
  };
}

/**
 * Base factice : `select().from(table)` est **awaitable** (grilles/barèmes lus sans
 * `where`) ET expose `.where()` (foyer/contrat/prestations). Les lignes renvoyées
 * dépendent de la table interrogée.
 */
function fakeDb(donnees: {
  foyers?: readonly unknown[];
  versions?: readonly unknown[];
  contrats?: readonly unknown[];
  prestations?: readonly unknown[];
  grilles?: readonly unknown[];
  baremes?: readonly unknown[];
}): Database {
  const rowsFor = (table: unknown): readonly unknown[] => {
    if (table === foyer) return donnees.foyers ?? [];
    if (table === foyerVersion) return donnees.versions ?? [];
    if (table === contrat) return donnees.contrats ?? [];
    if (table === grilleTarifaire) return donnees.grilles ?? [];
    if (table === baremePsu) return donnees.baremes ?? [];
    return donnees.prestations ?? [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows = rowsFor(table);
        return Object.assign(Promise.resolve(rows), {
          where: () => Promise.resolve(rows),
        });
      },
    }),
  } as unknown as Database;
}

/** Client `svc-foyer` de repli : `undefined` = échec total (réseau/CB). */
function foyerClient(reponse: 'ok' | 'echec' = 'ok'): FoyerClient {
  return {
    foyer: () =>
      Promise.resolve(
        reponse === 'ok'
          ? {
              id: FOYER_ID,
              ressourcesMensuellesCentimes: 671692,
              rfrCentimes: 7270500,
              tranche: 3 as const,
              nbParts: 2,
              nbEnfantsACharge: 2,
            }
          : undefined,
      ),
  } as unknown as FoyerClient;
}

/** Client `svc-planification` de repli : `undefined` = échec, sinon la réponse. */
function planificationClient(
  prestations: readonly unknown[] | 'echec',
): PlanificationClient {
  return {
    prestations: (contratId: string, mois: string, simule: boolean) =>
      Promise.resolve(
        prestations === 'echec'
          ? undefined
          : { contratId, mois, simule, prestations },
      ),
  } as unknown as PlanificationClient;
}

/**
 * Client `svc-referentiel` de repli. `grille: 'ok'` renvoie une grille cantine T3
 * (repli REST honoré) ; `'echec'` = échec total (503 attendu).
 */
function referentielClient(
  grille: 'ok' | 'echec' = 'echec',
): ReferentielClient {
  return {
    grilleApplicable: () =>
      Promise.resolve(
        grille === 'ok'
          ? {
              mode: 'CANTINE',
              tranche: 3,
              valideDu: '2026-01-01',
              valideAu: null,
              totalCentimes: 1268,
              partGardeCentimes: 801,
            }
          : undefined,
      ),
    baremePsuApplicable: () => Promise.resolve(undefined),
  } as unknown as ReferentielClient;
}

describe('CoutService — foyer versionné à date d’effet (DV-03, US-30-03)', () => {
  /** Version applicable en 2026 : tranche 3 (RFR 72 705 €). */
  const versionT3 = {
    id: 'a1111111-0000-4000-8000-000000000000',
    foyerId: FOYER_ID,
    dateEffet: '2026-01-01',
    ressourcesMensuellesCentimes: 671692,
    rfrCentimes: 7270500,
    tranche: 3,
    nbEnfantsACharge: 2,
    nbParts: '2',
    eventId: null,
    occurredAt: null,
    updatedAt: new Date(),
  };
  /** Nouvelle version au 1er janvier 2027 : RFR baissé → tranche 1. */
  const versionT1 = {
    ...versionT3,
    id: 'a2222222-0000-4000-8000-000000000000',
    dateEffet: '2027-01-01',
    rfrCentimes: 1500000,
    tranche: 1,
  };
  /** Grille cantine tranche 1 (montant distinct de la T3). */
  const grilleCantineT1 = {
    ...grilleCantine(),
    id: 'c1111111-0000-4000-8000-000000000000',
    tranche: 1,
    parametres: { cantineTotalCentimes: 1050, cantinePartGardeCentimes: null },
  };

  it('RFR changé au 2027-01-01 : décembre 2026 inchangé (T3), janvier 2027 recalculé (T1)', async () => {
    const db = fakeDb({
      foyers: [],
      versions: [versionT3, versionT1],
      contrats: [CONTRAT_ROW],
      prestations: [PRESTATION_ROW], // 16 jours cantine (fakeDb ignore le mois)
      grilles: [grilleCantine(), grilleCantineT1],
    });
    const service = new CoutService(
      db,
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );

    const dec = await service.coutMois(FOYER_ID, '2026-12', false);
    const jan = await service.coutMois(FOYER_ID, '2027-01', false);

    // Décembre 2026 : version T3 → 16 × 12,68 € (inchangé).
    expect(dec.totalCentimes).toBe(20288);
    // Janvier 2027 : version T1 → 16 × 10,50 € (recalculé à la nouvelle tranche).
    expect(jan.totalCentimes).toBe(16800);
  });

  it('foyer mono-version (aucune version projetée) : retombe sur la ligne courante — comportement inchangé', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        versions: [],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(20288);
  });
});

describe('CoutService — sémantique d’erreur explicite (503, jamais de montant faux)', () => {
  it('read model chaud : calcule le mois sans repli (non-régression)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'), // jamais appelé : la projection foyer est chaude
      planificationClient('echec'), // jamais appelé : la prestation est projetée
      referentielClient('echec'), // jamais appelé : la grille est projetée
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.prestations).toHaveLength(1);
    expect(vue.prestations[0]?.mode).toBe('CANTINE');
    expect(vue.totalCentimes).toBe(20288); // 16 × 12,68 €
  });

  it('grille absente du read model + repli referentiel OK : valorise via le repli REST', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
        grilles: [], // read-model froid côté grille
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('ok'), // le repli /grilles/applicable répond
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(20288);
  });

  it('grille absente du read model + repli referentiel KO : 503 (pas de montant faux)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
        grilles: [],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    await expect(
      service.coutMois(FOYER_ID, '2026-10', false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('CA1/CA2 (US-30-02) : juin valorisé avec l’ancienne grille, septembre avec la nouvelle', async () => {
    const db = fakeDb({
      foyers: [FOYER_ROW],
      contrats: [CONTRAT_ROW],
      prestations: [PRESTATION_ROW], // 16 jours cantine (fakeDb ignore le mois)
      grilles: [
        grilleCantine({
          valideDu: '2026-01-01',
          valideAu: '2026-08-31',
          cantineTotalCentimes: 1000, // ancienne grille : 10,00 €/jour
        }),
        grilleCantine({
          valideDu: '2026-09-01',
          valideAu: null,
          cantineTotalCentimes: 1268, // nouvelle grille : 12,68 €/jour
        }),
      ],
    });
    const service = new CoutService(
      db,
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const juin = await service.coutMois(FOYER_ID, '2026-06', false);
    const septembre = await service.coutMois(FOYER_ID, '2026-09', false);
    expect(juin.totalCentimes).toBe(16000); // 16 × 10,00 €
    // Septembre inclut aussi les frais fixes ABCM (cotisation, 286 €) ; on isole
    // la ligne cantine de la nouvelle grille.
    const cantineSept = septembre.prestations.find((p) => p.mode === 'CANTINE');
    expect(cantineSept?.totalCentimes).toBe(20288); // 16 × 12,68 €
    // US-30-04 « Calculé avec » : la date d'effet de la grille résolue et du
    // contrat remontent avec chaque prestation (juin = ancienne grille, sept = nouvelle).
    const cantineJuin = juin.prestations.find((p) => p.mode === 'CANTINE');
    expect(cantineJuin?.grilleValideDu).toBe('2026-01-01');
    expect(cantineSept?.grilleValideDu).toBe('2026-09-01');
    // Le contrat ayant servi (read-model `contrat`, début '2026-09-01').
    expect(cantineJuin?.contratValideDu).toBe('2026-09-01');
    expect(cantineSept?.contratValideDu).toBe('2026-09-01');
  });

  it('foyer absent du read model + repli OK : calcul normal', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
        grilles: [grilleCantine()],
      }),
      foyerClient('ok'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBeGreaterThan(0);
  });

  it('foyer absent + repli KO : coutMois rejette en 503 (pas de foyer neutre)', async () => {
    const service = new CoutService(
      fakeDb({ foyers: [], contrats: [], prestations: [] }),
      foyerClient('echec'),
      planificationClient([]),
      referentielClient('echec'),
    );
    await expect(
      service.coutMois(FOYER_ID, '2026-10', false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('foyer absent + repli KO : coutAnnuel rejette en 503 en bloc', async () => {
    const service = new CoutService(
      fakeDb({ foyers: [], contrats: [], prestations: [] }),
      foyerClient('echec'),
      planificationClient([]),
      referentielClient('echec'),
    );
    await expect(
      service.coutAnnuel(FOYER_ID, 2026, false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('contrat sans projection + repli KO : 503 (pas de total sous-estimé)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [], // read model froid pour ce contrat/mois
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    await expect(
      service.coutMois(FOYER_ID, '2026-10', false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('contrat sans projection + repli OK vide : mois calculé sans ce contrat', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [],
      }),
      foyerClient('echec'),
      planificationClient([]), // repli RÉUSSIT : zéro prestation ce mois
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.prestations).toHaveLength(0);
    expect(vue.totalCentimes).toBe(0);
  });

  it('coutAnnuel : un seul mois incalculable (repli planification KO) → 503 en bloc', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        // Seul octobre est projeté : les 11 autres mois passent par le repli.
        prestations: [PRESTATION_ROW],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    await expect(
      service.coutAnnuel(FOYER_ID, 2026, false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('coalescence annuelle : une promesse rejetée n’est pas resservie', async () => {
    let repliDisponible = false;
    const client = {
      prestations: (contratId: string, mois: string, simule: boolean) =>
        Promise.resolve(
          repliDisponible
            ? { contratId, mois, simule, prestations: [] }
            : undefined,
        ),
    } as unknown as PlanificationClient;
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      client,
      referentielClient('echec'),
    );
    await expect(
      service.coutAnnuel(FOYER_ID, 2026, false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Le service se rétablit : le prochain appel recalcule (clé purgée).
    repliDisponible = true;
    const vue = await service.coutAnnuel(FOYER_ID, 2026, false);
    expect(vue.mois).toHaveLength(12);
    expect(vue.totalCentimes).toBeGreaterThan(0);
  });

  it('frais fixes ABCM : contrat « première inscription » (année scolaire du mois) → 436 €', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [{ ...CONTRAT_ROW, premiereInscription: true }],
        prestations: [{ ...PRESTATION_ROW, mois: '2026-09' }],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-09', false);
    const frais = vue.prestations.find((p) => p.mode === 'FRAIS_FIXES_ABCM');
    expect(frais?.totalCentimes).toBe(43600); // 286 € cotisation + 150 € 1ère inscription
    expect(frais?.lignes.map((l) => l.libelle)).toEqual([
      'Cotisation annuelle ABCM',
      'Frais de 1ère inscription',
    ]);
  });

  it('frais fixes ABCM : même contrat l’année scolaire suivante → cotisation seule (286 €)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [{ ...CONTRAT_ROW, premiereInscription: true }],
        prestations: [{ ...PRESTATION_ROW, mois: '2027-09' }],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2027-09', false);
    const frais = vue.prestations.find((p) => p.mode === 'FRAIS_FIXES_ABCM');
    expect(frais?.totalCentimes).toBe(28600);
  });

  it('frais fixes ABCM : aucun contrat marqué « première inscription » → cotisation seule', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW], // premiereInscription: false
        prestations: [{ ...PRESTATION_ROW, mois: '2026-09' }],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-09', false);
    const frais = vue.prestations.find((p) => p.mode === 'FRAIS_FIXES_ABCM');
    expect(frais?.totalCentimes).toBe(28600);
  });

  it('projection corrompue : erreur Zod explicite, PAS un 503', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [
          { ...PRESTATION_ROW, prestations: { mode: 'CANTINE' } }, // nbJours manquant
        ],
        grilles: [grilleCantine()],
      }),
      foyerClient('echec'),
      planificationClient([]),
      referentielClient('echec'),
    );
    const rejet = service.coutMois(FOYER_ID, '2026-10', false);
    await expect(rejet).rejects.toThrow(/prestation projetée invalide/);
    await expect(rejet).rejects.not.toBeInstanceOf(ServiceUnavailableException);
  });
});

/** Contrat/prestation crèche PSU (Mia, 885,5 h / 7 mensualités). */
const CONTRAT_PSU = { ...CONTRAT_ROW, mode: 'CRECHE_PSU' };
const PRESTATION_PSU = {
  ...PRESTATION_ROW,
  mode: 'CRECHE_PSU',
  prestations: {
    mode: 'CRECHE_PSU',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
  },
};

/** Barème PSU 2026 projeté (taux CNAF, bornes optionnelles). */
function baremeRow(
  bornes: { plancherCentimes?: number; plafondCentimes?: number } = {},
): Record<string, unknown> {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    valideDu: '2026-01-01',
    valideAu: null,
    taux: {
      '1': 0.000619,
      '2': 0.000516,
      '3': 0.000413,
      '4': 0.00031,
      '5': 0.00031,
      '6': 0.00031,
      '7': 0.00031,
      '8': 0.000206,
    },
    plancherCentimes: bornes.plancherCentimes ?? null,
    plafondCentimes: bornes.plafondCentimes ?? null,
    eventId: null,
    occurredAt: null,
    updatedAt: new Date(),
  };
}

/** Client référentiel renvoyant une réponse REST arbitraire (repli /grilles/applicable). */
function referentielRepli(
  grille: unknown,
  bareme?: unknown,
): ReferentielClient {
  return {
    grilleApplicable: () => Promise.resolve(grille),
    baremePsuApplicable: () => Promise.resolve(bareme),
  } as unknown as ReferentielClient;
}

describe('CoutService — résolution PSU + modes ABCM à date', () => {
  it('crèche PSU : barème projeté résout la mensualité (CT-02) = 438,96 €', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_PSU],
        prestations: [PRESTATION_PSU],
        baremes: [baremeRow()],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(43896);
  });

  it('crèche PSU : barème avec plancher/plafond CNAF projetés (bornes appliquées)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_PSU],
        prestations: [PRESTATION_PSU],
        baremes: [
          baremeRow({ plancherCentimes: 80000, plafondCentimes: 700000 }),
        ],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    // Ressources 671 692 c. ∈ [80 000, 700 000] → inchangées, même mensualité.
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(43896);
  });

  it('crèche PSU : barème absent du read model + repli REST OK', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_PSU],
        prestations: [PRESTATION_PSU],
        baremes: [],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielRepli(undefined, {
        mode: 'CRECHE_PSU',
        valideDu: '2026-01-01',
        valideAu: null,
        taux: { '1': 0.000619, '2': 0.000516 },
        plancherCentimes: null,
        plafondCentimes: null,
      }),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(43896);
  });

  it('crèche PSU : barème absent + repli KO → 503 (pas de tarif faux)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_PSU],
        prestations: [PRESTATION_PSU],
        baremes: [],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    await expect(
      service.coutMois(FOYER_ID, '2026-10', false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('périscolaire : repli REST projette matin/soir (CT-11) = 111,24 €', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [{ ...CONTRAT_ROW, mode: 'PERISCOLAIRE' }],
        prestations: [
          {
            ...PRESTATION_ROW,
            mode: 'PERISCOLAIRE',
            prestations: { mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 12 },
          },
        ],
        grilles: [],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielRepli({
        mode: 'PERISCOLAIRE',
        tranche: 3,
        valideDu: '2026-01-01',
        valideAu: null,
        matinCentimes: 333,
        soirCentimes: 705,
      }),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(11124);
  });

  it('ALSH : grille projetée (read-model) valorise 5 journées (CT-12) = 132,50 €', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [{ ...CONTRAT_ROW, mode: 'ALSH' }],
        prestations: [
          {
            ...PRESTATION_ROW,
            mode: 'ALSH',
            prestations: { mode: 'ALSH', nbJourneesCompletes: 5 },
          },
        ],
        grilles: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            mode: 'ALSH',
            tranche: 3,
            valideDu: '2026-01-01',
            valideAu: null,
            parametres: {
              alshJourneeCompleteCentimes: 2650,
              alshDemiJourneeCentimes: 950,
              alshRepasCentimes: 750,
            },
            eventId: null,
            occurredAt: null,
            updatedAt: new Date(),
          },
        ],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(13250);
  });

  it('ALSH : repli REST projette journée/demi/repas', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [{ ...CONTRAT_ROW, mode: 'ALSH' }],
        prestations: [
          {
            ...PRESTATION_ROW,
            mode: 'ALSH',
            prestations: {
              mode: 'ALSH',
              nbJourneesCompletes: 2,
              nbDemiJournees: 3,
              nbRepas: 4,
            },
          },
        ],
        grilles: [],
      }),
      foyerClient('echec'),
      planificationClient('echec'),
      referentielRepli({
        mode: 'ALSH',
        tranche: 3,
        valideDu: '2026-01-01',
        valideAu: null,
        journeeCompleteCentimes: 2650,
        demiJourneeCentimes: 950,
        repasCentimes: 750,
      }),
    );
    // 2×2650 + 3×950 + 4×750 = 5300 + 2850 + 3000 = 11150.
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBe(11150);
  });
});
