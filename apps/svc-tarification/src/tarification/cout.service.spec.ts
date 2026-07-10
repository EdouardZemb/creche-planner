import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { CoutService } from './cout.service.js';
import type { Database } from '../database/database.types.js';
import { contrat, foyer } from '../database/schema.js';
import type { FoyerClient } from '../fallback/foyer.client.js';
import type { PlanificationClient } from '../fallback/planification.client.js';

/**
 * Tests de la **sémantique d'erreur explicite** du service de coût (plus jamais
 * de montant faux silencieux) : un repli synchrone qui ÉCHOUE (foyer ou
 * prestations injoignables) répond 503 — jamais un « foyer neutre » ni un total
 * sous-estimé — tandis qu'un repli qui RÉUSSIT vide (contrat sans prestation ce
 * mois) reste une omission légitime. Le calcul lui-même est couvert par le
 * domaine et la vérification Pact provider (base réelle) ; ici la base et les
 * clients de repli sont des doubles en mémoire.
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

/**
 * Base factice : `select().from(table).where()` renvoie les lignes du jeu de
 * données selon la table interrogée (`foyer`, `contrat`, sinon
 * `prestation_mois` — mois et année partagent la même requête).
 */
function fakeDb(donnees: {
  foyers?: readonly unknown[];
  contrats?: readonly unknown[];
  prestations?: readonly unknown[];
}): Database {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === foyer) {
            return Promise.resolve(donnees.foyers ?? []);
          }
          if (table === contrat) {
            return Promise.resolve(donnees.contrats ?? []);
          }
          return Promise.resolve(donnees.prestations ?? []);
        },
      }),
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

describe('CoutService — sémantique d’erreur explicite (503, jamais de montant faux)', () => {
  it('read model chaud : calcule le mois sans repli (non-régression)', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
      }),
      foyerClient('echec'), // jamais appelé : la projection foyer est chaude
      planificationClient('echec'), // jamais appelé : la prestation est projetée
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.prestations).toHaveLength(1);
    expect(vue.prestations[0]?.mode).toBe('CANTINE');
    expect(vue.totalCentimes).toBeGreaterThan(0);
  });

  it('foyer absent du read model + repli OK : calcul normal', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [],
        contrats: [CONTRAT_ROW],
        prestations: [PRESTATION_ROW],
      }),
      foyerClient('ok'),
      planificationClient('echec'),
    );
    const vue = await service.coutMois(FOYER_ID, '2026-10', false);
    expect(vue.totalCentimes).toBeGreaterThan(0);
  });

  it('foyer absent + repli KO : coutMois rejette en 503 (pas de foyer neutre)', async () => {
    const service = new CoutService(
      fakeDb({ foyers: [], contrats: [], prestations: [] }),
      foyerClient('echec'),
      planificationClient([]),
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
      }),
      foyerClient('echec'),
      planificationClient('echec'),
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
      }),
      foyerClient('echec'),
      client,
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

  it('projection corrompue : erreur Zod explicite, PAS un 503', async () => {
    const service = new CoutService(
      fakeDb({
        foyers: [FOYER_ROW],
        contrats: [CONTRAT_ROW],
        prestations: [
          { ...PRESTATION_ROW, prestations: { mode: 'CANTINE' } }, // nbJours manquant
        ],
      }),
      foyerClient('echec'),
      planificationClient([]),
    );
    const rejet = service.coutMois(FOYER_ID, '2026-10', false);
    await expect(rejet).rejects.toThrow(/prestation projetée invalide/);
    await expect(rejet).rejects.not.toBeInstanceOf(ServiceUnavailableException);
  });
});
