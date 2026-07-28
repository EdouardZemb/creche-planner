import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ReferentielClient } from '../clients/referentiel.client.js';
import { ErreurAmont } from '../clients/appel-resilient.js';
import { ReferentielBffController } from './referentiel.controller.js';

/**
 * Façade BFF `/api/v1/referentiel` (SFD 30, lot 6) : relais du catalogue tarifaire
 * global (aucun scoping foyer). On vérifie le relais des méthodes du client et que
 * le **409 structuré** amont (chevauchement) est réémis TEL QUEL par `relayer`
 * (l'écran lit `code: 'PERIODE_CHEVAUCHANTE'`).
 */
const GRILLE = {
  id: 'g-1',
  tranche: 3,
  valideDu: '2026-09-01',
  valideAu: null,
  cantineTotalCentimes: 1268,
  cantinePartGardeCentimes: 801,
  periMatinCentimes: 333,
  periSoirCentimes: 705,
  alshJourneeCompleteCentimes: 2650,
  alshDemiJourneeCentimes: 950,
  alshRepasCentimes: 750,
};

function fakeClient(
  overrides: Partial<ReferentielClient> = {},
): ReferentielClient {
  return {
    listerGrilles: vi.fn(() => Promise.resolve([GRILLE])),
    publierGrille: vi.fn(() => Promise.resolve([GRILLE])),
    publierBaremePsu: vi.fn(() => Promise.resolve({} as never)),
    publierBaremeTranches: vi.fn(() => Promise.resolve({} as never)),
    ...overrides,
  } as unknown as ReferentielClient;
}

describe('ReferentielBffController (BFF, SFD 30 lot 6)', () => {
  it('GET grilles relaie la liste du catalogue', async () => {
    const client = fakeClient();
    const vues = await new ReferentielBffController(client).listerGrilles();
    expect(vues).toEqual([GRILLE]);
    expect(client.listerGrilles).toHaveBeenCalledOnce();
  });

  it('POST grilles relaie la publication', async () => {
    const client = fakeClient();
    const corps = { valideDu: '2026-09-01', tranches: [] };
    const vues = await new ReferentielBffController(client).publierGrille(
      corps,
    );
    expect(vues).toEqual([GRILLE]);
    expect(client.publierGrille).toHaveBeenCalledWith(corps);
  });

  it('réémet le 409 structuré (PERIODE_CHEVAUCHANTE) tel quel', async () => {
    const corpsErreur = {
      statusCode: 409,
      code: 'PERIODE_CHEVAUCHANTE',
      message: 'chevauchement',
    };
    const client = fakeClient({
      publierGrille: vi.fn(() =>
        Promise.reject(new ErreurAmont(409, corpsErreur)),
      ),
    });
    const controller = new ReferentielBffController(client);

    const err = await controller
      .publierGrille({ valideDu: '2026-09-01', tranches: [] })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect((err as HttpException).getResponse()).toEqual(corpsErreur);
  });
});
