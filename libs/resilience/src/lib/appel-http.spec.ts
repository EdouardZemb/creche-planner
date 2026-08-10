import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  appelHttpOuRepli,
  appelHttpResilient,
  ErreurAmont,
  estErreurHttpRejouable,
  executerAppelHttp,
  type ConfigAppelHttpResilient,
} from './appel-http.js';
import { CircuitBreaker, type OptionsResilience } from './resilience.js';

/**
 * Plomberie HTTP partagée des clients REST (lot D1). Le point le plus sensible
 * est le **test golden des en-têtes sortants** : la factorisation ne doit rien
 * changer à ce qui part sur le réseau, puisque deux mécanismes de sécurité
 * distincts (identité parent côté gateway, assertion machine HMAC entre
 * services) reposent dessus. On vérifie donc, en plus des cas d'erreur, que les
 * en-têtes fournis sont émis **tels quels**, que `Content-Type` n'est ajouté que
 * s'il y a un corps, et que le fournisseur est ré-évalué à chaque tentative.
 */

const OPTIONS: OptionsResilience = {
  timeoutMs: 50,
  retries: 1,
  delaiEntreEssaisMs: 1,
};

const schemaOk = z.object({ valeur: z.string() });

/** Logger muet : les traces `debug`/`warn` ne doivent pas polluer la sortie. */
function loggerMuet(): Logger {
  const logger = new Logger('test');
  vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return logger;
}

type ConfigTest = ConfigAppelHttpResilient<{ valeur: string }> & {
  readonly schema: z.ZodType<{ valeur: string }>;
};

function config(
  surcharges: Partial<ConfigAppelHttpResilient<unknown>> = {},
): ConfigTest {
  return {
    service: 'svc-amont',
    logger: loggerMuet(),
    breaker: new CircuitBreaker(),
    options: OPTIONS,
    entetes: () => ({ 'x-assertion': 'jeton' }),
    methode: 'GET',
    url: 'http://amont/api/ressource',
    schema: schemaOk,
    ...surcharges,
  } as ConfigTest;
}

/** Stub de `fetch` renvoyant une réponse 2xx au corps JSON fourni. */
function fetchOk(corps: unknown = { valeur: 'v' }): ReturnType<typeof vi.fn> {
  const stub = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(corps),
    }),
  );
  vi.stubGlobal('fetch', stub);
  return stub;
}

/** Init de la n-ième requête émise (1-indexée). */
function initDe(stub: ReturnType<typeof vi.fn>, n = 1): RequestInit {
  return (stub.mock.calls[n - 1]?.[1] ?? {}) as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('appelHttpResilient — en-têtes sortants (golden)', () => {
  it('émet les en-têtes fournis TELS QUELS, sans Content-Type, quand il n’y a pas de corps', async () => {
    const stub = fetchOk();

    await appelHttpResilient(config());

    expect(initDe(stub).headers).toEqual({ 'x-assertion': 'jeton' });
    expect(initDe(stub).method).toBe('GET');
    expect(initDe(stub).body).toBeUndefined();
  });

  it('ajoute `Content-Type: application/json` et sérialise le corps quand il y en a un', async () => {
    const stub = fetchOk();

    await appelHttpResilient(config({ methode: 'POST', corps: { a: 1 } }));

    expect(initDe(stub).headers).toEqual({
      'Content-Type': 'application/json',
      'x-assertion': 'jeton',
    });
    expect(initDe(stub).body).toBe('{"a":1}');
    expect(initDe(stub).method).toBe('POST');
  });

  it('ré-évalue le fournisseur d’en-têtes à CHAQUE tentative (assertion datée)', async () => {
    let n = 0;
    const stub = vi.fn(() =>
      n === 1
        ? Promise.reject(new Error('réseau'))
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ valeur: 'v' }),
          }),
    );
    vi.stubGlobal('fetch', stub);

    await appelHttpResilient(
      config({
        entetes: () => {
          n += 1;
          return { 'x-assertion': `jeton-${String(n)}` };
        },
      }),
    );

    expect(initDe(stub, 1).headers).toEqual({ 'x-assertion': 'jeton-1' });
    expect(initDe(stub, 2).headers).toEqual({ 'x-assertion': 'jeton-2' });
  });

  it('trace l’appel UNE seule fois, hors boucle de retry', async () => {
    fetchOk();
    const logger = loggerMuet();

    await appelHttpResilient(config({ logger }));

    expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
      'GET http://amont/api/ressource',
    );
  });
});

describe('appelHttpResilient — réponses', () => {
  it('valide le corps par le schéma Zod fourni', async () => {
    fetchOk({ valeur: 'v', ignore: true });

    await expect(appelHttpResilient(config())).resolves.toEqual({
      valeur: 'v',
    });
  });

  it('propage une erreur de forme (Zod) après épuisement des tentatives', async () => {
    fetchOk({ pasLaBonneForme: true });

    await expect(appelHttpResilient(config())).rejects.toThrow();
  });

  it('ne lit aucun corps quand aucun schéma n’est fourni (204)', async () => {
    const json = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 204, json })),
    );

    await expect(
      appelHttpResilient(config({ schema: undefined })),
    ).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('lève `Error("HTTP <code>")` sur une réponse non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503 })),
    );

    await expect(appelHttpResilient(config())).rejects.toThrow('HTTP 503');
  });
});

describe('appelHttpResilient — capture du corps d’erreur (opt-in)', () => {
  it('lève `ErreurAmont(status, corps)` quand le corps d’erreur est parseable', async () => {
    const corps = { code: 'PERIODE_CHEVAUCHANTE' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve(corps),
        }),
      ),
    );

    const erreur = await appelHttpResilient(
      config({ capturerCorpsErreur: true }),
    ).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurAmont);
    expect((erreur as ErreurAmont).status).toBe(409);
    expect((erreur as ErreurAmont).corps).toEqual(corps);
    // `message` reste « HTTP <code> » : les replis qui lisent le message (5xx)
    // fonctionnent à l'identique quand le corps n'est pas relayé.
    expect((erreur as ErreurAmont).message).toBe('HTTP 409');
  });

  it('retombe sur `Error("HTTP <code>")` si le corps d’erreur n’est pas du JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.reject(new Error('pas du JSON')),
        }),
      ),
    );

    const erreur = await appelHttpResilient(
      config({ capturerCorpsErreur: true }),
    ).catch((e: unknown) => e);

    expect(erreur).not.toBeInstanceOf(ErreurAmont);
    expect((erreur as Error).message).toBe('HTTP 400');
  });
});

describe('appelHttpOuRepli', () => {
  it('renvoie la valeur nominale quand l’amont répond', async () => {
    fetchOk();

    await expect(appelHttpOuRepli(config(), undefined)).resolves.toEqual({
      valeur: 'v',
    });
  });

  it('renvoie le repli et journalise un avertissement en cas d’échec total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const logger = loggerMuet();

    await expect(appelHttpOuRepli(config({ logger }), 'repli')).resolves.toBe(
      'repli',
    );
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('executerAppelHttp (one-shot, sans retry ni disjoncteur)', () => {
  it('n’émet qu’UNE requête, même en échec — le jeton one-shot ne doit pas être rejoué', async () => {
    const stub = vi.fn(() => Promise.resolve({ ok: false, status: 400 }));
    vi.stubGlobal('fetch', stub);

    await expect(
      executerAppelHttp({
        service: 'svc-amont',
        logger: loggerMuet(),
        options: OPTIONS,
        entetes: () => ({ 'x-assertion': 'jeton' }),
        methode: 'POST',
        url: 'http://amont/api/desabonnement',
        corps: { token: 't' },
      }),
    ).rejects.toThrow('HTTP 400');
    expect(stub).toHaveBeenCalledOnce();
  });

  it('valide la réponse par le schéma quand il y en a un', async () => {
    fetchOk();

    await expect(
      executerAppelHttp({
        service: 'svc-amont',
        logger: loggerMuet(),
        options: OPTIONS,
        entetes: () => ({}),
        methode: 'GET',
        url: 'http://amont/api/ressource',
        schema: schemaOk,
      }),
    ).resolves.toEqual({ valeur: 'v' });
  });
});

describe('estErreurHttpRejouable (AM-42)', () => {
  it('rejoue le réseau, les 5xx et les 4xx transitoires (408, 429)', () => {
    expect(estErreurHttpRejouable(new TypeError('fetch failed'))).toBe(true);
    expect(estErreurHttpRejouable(new Error('HTTP 503'))).toBe(true);
    expect(estErreurHttpRejouable(new ErreurAmont(500, {}))).toBe(true);
    expect(estErreurHttpRejouable(new ErreurAmont(408, {}))).toBe(true);
    expect(estErreurHttpRejouable(new Error('HTTP 429'))).toBe(true);
    expect(estErreurHttpRejouable('panne brute')).toBe(true);
  });

  it('ne rejoue pas un 4xx définitif', () => {
    expect(estErreurHttpRejouable(new Error('HTTP 400'))).toBe(false);
    expect(estErreurHttpRejouable(new ErreurAmont(404, {}))).toBe(false);
    expect(estErreurHttpRejouable(new ErreurAmont(409, {}))).toBe(false);
  });
});

describe('appelHttpResilient — discrimination des ré-essais (AM-42)', () => {
  it('rejoue un 503 (transitoire)', async () => {
    const stub = vi.fn(() => Promise.resolve({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', stub);

    await expect(appelHttpResilient(config())).rejects.toThrow('HTTP 503');
    expect(stub).toHaveBeenCalledTimes(2); // 1 + retries: 1
  });

  it('ne rejoue pas un 409 (définitif) — une seule requête part', async () => {
    const stub = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ code: 'CONFLIT' }),
      }),
    );
    vi.stubGlobal('fetch', stub);

    await expect(
      appelHttpResilient(config({ capturerCorpsErreur: true })),
    ).rejects.toThrow('HTTP 409');
    expect(stub).toHaveBeenCalledOnce();
  });
});
