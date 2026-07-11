import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  loadConfig: () => ({ foyerUrl: 'http://svc-foyer:3002' }),
}));

import { FoyerClient } from './foyer.client.js';
import { ErreurAmont } from './appel-resilient.js';

/**
 * Tests unitaires du `FoyerClient` (fetch mocké, aucune infra). Deux volets :
 *
 * - **Capture du corps d'erreur amont** (Lot 1) : `svc-foyer` porte des 409
 *   structurés ; sur une réponse non-2xx **au corps JSON parseable**, le client
 *   lève `ErreurAmont(status, corps)` — que `relayer` réémet tel quel ; sinon
 *   (corps non-JSON) il retombe sur `Error('HTTP <code>')`.
 * - **Création atomique** (Lot 2) : `creerFoyer` sérialise le payload étendu
 *   (`enfants`/`parents`/`createurEmail`) tel quel, parse le **dossier complet**
 *   (Zod) et — passant par le même `capturerCorpsErreur` que les autres méthodes —
 *   propage un 409 amont **structuré** (dossier annulé par `svc-foyer`).
 *
 * `fetch` global est mocké (fabrique une réponse **fraîche** à chaque appel :
 * `OPTIONS.retries = 1` ⇒ 2 appels sur échec, corps non déjà consommé). Le
 * contrat réseau réel reste couvert par le Pact consumer.
 */
function reponseJson(status: number, corps: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corps),
  } as unknown as Response;
}

function reponseNonJson(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new SyntaxError('corps non JSON')),
  } as unknown as Response;
}

const FOYER_ID = '11111111-1111-4111-8111-111111111111';

/** Dossier complet tel que renvoyé par `svc-foyer` (POST /api/foyers → 201). */
const DOSSIER = {
  foyer: {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 671692,
    ressourcesMensuellesEuros: 6716.92,
    rfrCentimes: 7270500,
    rfrEuros: 72705,
    nbEnfantsACharge: 2,
    nbParts: 3,
    tranche: 3,
  },
  enfants: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      foyerId: FOYER_ID,
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    },
  ],
  parents: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      foyerId: FOYER_ID,
      prenom: 'Camille',
      nom: 'Martin',
      email: 'saisi@example.test',
      principal: true,
      ordre: 0,
      actif: true,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      foyerId: FOYER_ID,
      prenom: null,
      nom: null,
      email: 'createur@example.test',
      principal: false,
      ordre: 1,
      actif: true,
    },
  ],
};

/** Saisie de création de référence (dossier complet + créateur). */
const SAISIE = {
  ressourcesMensuelles: 6716.92,
  rfr: 72705,
  nbEnfantsACharge: 2,
  nbParts: 3,
  enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
  parents: [
    {
      email: 'saisi@example.test',
      prenom: 'Camille',
      nom: 'Martin',
      principal: true,
      ordre: 0,
    },
  ],
  createurEmail: 'createur@example.test',
};

describe('FoyerClient · capture du corps d’erreur amont', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lève ErreurAmont(409, corps) sur un 409 structuré de svc-foyer', async () => {
    const corps = {
      statusCode: 409,
      code: 'DERNIER_PARENT_ACTIF',
      message: 'impossible de retirer le dernier parent actif du foyer',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseJson(409, corps))),
    );

    const err = await new FoyerClient()
      .retirerParent('foyer-1', 'parent-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ErreurAmont);
    expect((err as ErreurAmont).status).toBe(409);
    expect((err as ErreurAmont).corps).toEqual(corps);
  });

  it('retombe sur Error(HTTP <code>) si le corps n’est pas du JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseNonJson(409))),
    );

    const err = await new FoyerClient()
      .retirerParent('foyer-1', 'parent-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ErreurAmont);
    expect((err as Error).message).toBe('HTTP 409');
  });
});

describe('FoyerClient.creerFoyer (création atomique)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('POST /api/foyers avec le payload étendu, et parse le dossier complet', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reponseJson(201, DOSSIER)));
    vi.stubGlobal('fetch', fetchMock);

    const dossier = await new FoyerClient().creerFoyer(SAISIE);

    expect(fetchMock).toHaveBeenCalledOnce();
    const appel = fetchMock.mock.calls[0];
    if (!appel) {
      throw new Error('fetch n’a pas été appelé');
    }
    const [url, init] = appel as unknown as [string, RequestInit | undefined];
    expect(url).toBe('http://svc-foyer:3002/api/foyers');
    expect(init?.method).toBe('POST');
    // Le payload voyage tel quel : enfants + parents + createurEmail inclus.
    if (typeof init?.body !== 'string') {
      throw new Error('corps de requête JSON attendu (chaîne)');
    }
    const corpsEnvoye = JSON.parse(init.body) as Record<string, unknown>;
    expect(corpsEnvoye).toEqual(SAISIE);
    // La réponse est validée (Zod) puis rendue telle quelle : dossier complet.
    expect(dossier).toEqual(DOSSIER);
    expect(dossier.parents[1]?.email).toBe('createur@example.test');
  });

  it('propage un 409 amont STRUCTURÉ (dossier annulé par svc-foyer)', async () => {
    // Un 409 au corps JSON parseable remonte via `capturerCorpsErreur` comme les
    // autres méthodes : `ErreurAmont(409, corps)`, que `relayer` réémet tel quel.
    const corps = {
      statusCode: 409,
      code: 'EMAIL_DEJA_UTILISE',
      message: 'adresse e-mail déjà utilisée',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseJson(409, corps))),
    );

    const err = await new FoyerClient()
      .creerFoyer(SAISIE)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ErreurAmont);
    expect((err as ErreurAmont).status).toBe(409);
    expect((err as ErreurAmont).corps).toEqual(corps);
  });

  it('rejette une réponse amont hors contrat (l’ancienne vue foyer seule ne suffit plus)', async () => {
    // Réponse de l'ancien contrat (vue foyer scalaire) : le parse Zod du
    // dossier échoue — le client n'invente jamais un dossier partiel.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseJson(201, DOSSIER.foyer))),
    );

    await expect(new FoyerClient().creerFoyer(SAISIE)).rejects.toThrow();
  });
});
