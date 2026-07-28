import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  loadConfig: () => ({ referentielUrl: 'http://svc-referentiel:3001' }),
}));

import { ReferentielClient } from './referentiel.client.js';
import { ErreurAmont } from './appel-resilient.js';

/**
 * Tests unitaires du `ReferentielClient` (fetch mocké, aucune infra). On vérifie
 * que la publication de grille voyage vers `POST /api/grilles/abcm`, que la réponse
 * (liste de lignes) est validée (Zod), et surtout que le **409 structuré** de
 * `svc-referentiel` (chevauchement) est capturé (`ErreurAmont`) pour que `relayer`
 * le réémette tel quel — l'écran « Tarifs » lit alors `code`. Le contrat réseau
 * réel reste couvert par le Pact consumer.
 */
function reponseJson(status: number, corps: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corps),
  } as unknown as Response;
}

const GRILLE_VUE = {
  id: '44444444-0000-4000-8000-000000000000',
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

const CORPS_PUBLICATION = {
  valideDu: '2026-09-01',
  tranches: [{ tranche: 3, cantineTotal: 12.68 }],
};

describe('ReferentielClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('POST /api/grilles/abcm et parse la liste des lignes créées', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(reponseJson(201, [GRILLE_VUE])),
    );
    vi.stubGlobal('fetch', fetchMock);

    const vues = await new ReferentielClient().publierGrille(CORPS_PUBLICATION);

    const appel = fetchMock.mock.calls[0];
    if (!appel) {
      throw new Error('fetch n’a pas été appelé');
    }
    const [url, init] = appel as unknown as [string, RequestInit | undefined];
    expect(url).toBe('http://svc-referentiel:3001/api/grilles/abcm');
    expect(init?.method).toBe('POST');
    expect(vues).toEqual([GRILLE_VUE]);
  });

  it('capture le 409 structuré (PERIODE_CHEVAUCHANTE) en ErreurAmont', async () => {
    const corps = {
      statusCode: 409,
      code: 'PERIODE_CHEVAUCHANTE',
      message: 'chevauchement de périodes de validité',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseJson(409, corps))),
    );

    const err = await new ReferentielClient()
      .publierGrille(CORPS_PUBLICATION)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ErreurAmont);
    expect((err as ErreurAmont).status).toBe(409);
    expect((err as ErreurAmont).corps).toEqual(corps);
  });

  it('GET /api/grilles liste les grilles publiées', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(reponseJson(200, [GRILLE_VUE])),
    );
    vi.stubGlobal('fetch', fetchMock);

    const vues = await new ReferentielClient().listerGrilles();

    const appel = fetchMock.mock.calls[0];
    if (!appel) {
      throw new Error('fetch n’a pas été appelé');
    }
    const [url, init] = appel as unknown as [string, RequestInit | undefined];
    expect(url).toBe('http://svc-referentiel:3001/api/grilles');
    expect(init?.method).toBe('GET');
    expect(vues).toEqual([GRILLE_VUE]);
  });
});
