import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, AuthExpiredError } from './client';

// Le client n'est pas mocké ici : on stubbe `fetch` pour vérifier la mécanique
// transverse (redirect: 'manual', classification des redirections Access vs
// erreurs HTTP). Un seul endpoint (lireFoyer) suffit, tous passent par le même
// wrapper `requete`.

const fetchMock = vi.fn();

/** Réponse JSON ordinaire (type 'basic'), comme en dev/LAN sans Access. */
function reponse(
  status: number,
  corps?: unknown,
  entetes?: Record<string, string>,
): Response {
  return {
    type: 'basic',
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(entetes),
    json: () =>
      corps === undefined
        ? Promise.reject(new Error('pas de corps'))
        : Promise.resolve(corps),
  } as unknown as Response;
}

/** Réponse opaque produite par un navigateur sur redirection avec redirect:'manual'. */
function reponseOpaqueRedirect(): Response {
  return {
    type: 'opaqueredirect',
    ok: false,
    status: 0,
    headers: new Headers(),
    json: () => Promise.reject(new Error('réponse opaque')),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client API — détection de session Access expirée', () => {
  it('passe redirect:"manual" à fetch (sinon le 302 Access casse en CORS)', async () => {
    fetchMock.mockResolvedValue(
      reponse(200, { foyer: { id: 'f1' }, enfants: [] }),
    );

    await api.lireFoyer('f1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/foyers/f1',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('réponse 200 → données rendues (comportement nominal inchangé)', async () => {
    const dossier = { foyer: { id: 'f1' }, enfants: [] };
    fetchMock.mockResolvedValue(reponse(200, dossier));

    await expect(api.lireFoyer('f1')).resolves.toEqual(dossier);
  });

  it('réponse 404 → ApiError(404) (comportement actuel inchangé)', async () => {
    fetchMock.mockResolvedValue(reponse(404, undefined));

    await expect(api.lireFoyer('inconnu')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });

  it('redirection opaque (navigateur) → AuthExpiredError', async () => {
    fetchMock.mockResolvedValue(reponseOpaqueRedirect());

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('302 visible vers *.cloudflareaccess.com → AuthExpiredError', async () => {
    fetchMock.mockResolvedValue(
      reponse(302, undefined, {
        location:
          'https://mon-equipe.cloudflareaccess.com/cdn-cgi/access/login/creche.testlens.dev',
      }),
    );

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('302 visible vers une autre destination → ApiError (pas une session expirée)', async () => {
    fetchMock.mockResolvedValue(
      reponse(302, undefined, { location: 'https://exemple.fr/ailleurs' }),
    );

    const echec = api.lireFoyer('f1');
    await expect(echec).rejects.toBeInstanceOf(ApiError);
    await expect(echec).rejects.not.toBeInstanceOf(AuthExpiredError);
  });

  it('302 sans en-tête Location (ou Location illisible) → ApiError', async () => {
    fetchMock.mockResolvedValueOnce(reponse(302, undefined));
    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(
      reponse(302, undefined, { location: '::pas-une-url::' }),
    );
    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(ApiError);
  });

  it('échec réseau persistant (TypeError) → rejoué puis propagé (classé indisponible en aval)', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const p = api.lireFoyer('f1');
      const attente = expect(p).rejects.toBeInstanceOf(TypeError);
      // Laisse les deux backoffs (500 ms + 1,5 s) s'écouler.
      await vi.advanceTimersByTimeAsync(500 + 1500);
      await attente;

      // 1 tentative initiale + 2 rejeux bornés, puis abandon.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

// La résilience (retry borné + délai d'expiration) ne s'applique qu'aux appels
// idempotents : GET (ici lireFoyer) et écritures rejouables sans double effet
// (ecrireSemaineBesoins = upsert, validerSemaine = idempotente par clé unique).
// Les backoffs (500 ms / 1,5 s) sont pilotés par des timers factices.
describe('client API — résilience réseau (retry borné + timeout)', () => {
  const dossier = { foyer: { id: 'f1' }, enfants: [] };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET : un hoquet réseau (TypeError) est rejoué → succès à la 2e tentative', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reponse(200, dossier));

    const p = api.lireFoyer('f1');
    const attente = expect(p).resolves.toEqual(dossier);
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET : une 503 transitoire est rejouée → succès à la 2e tentative', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse(503, undefined))
      .mockResolvedValueOnce(reponse(200, dossier));

    const p = api.lireFoyer('f1');
    const attente = expect(p).resolves.toEqual(dossier);
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET : le nombre de rejeux est borné (3 tentatives au total)', async () => {
    fetchMock.mockResolvedValue(reponse(502, undefined));

    const p = api.lireFoyer('f1');
    const attente = expect(p).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(500 + 1500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('GET : une 4xx n’est JAMAIS rejouée (erreur applicative)', async () => {
    fetchMock.mockResolvedValue(reponse(409, undefined));

    await expect(api.lireFoyer('f1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET : une session Access expirée (redirection opaque) n’est pas rejouée', async () => {
    fetchMock.mockResolvedValue(reponseOpaqueRedirect());

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(AuthExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET : chaque requête porte un AbortSignal (délai d’expiration câblé)', async () => {
    fetchMock.mockResolvedValue(reponse(200, dossier));

    await api.lireFoyer('f1');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('GET : l’abandon de l’appelant pendant le backoff stoppe les rejeux', async () => {
    const ctrl = new AbortController();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(reponse(200, dossier));

    const p = api.lireFoyer('f1', { signal: ctrl.signal });
    const attente = expect(p).rejects.toBeInstanceOf(DOMException);
    // Laisse la 1re tentative échouer et entrer dans l'attente du backoff.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    ctrl.abort();
    await attente;
    // Pas de nouvelle tentative après abandon.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ecrireSemaineBesoins (upsert) : rejoué sur 502, corps rejoué à l’identique', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse(502, undefined))
      .mockResolvedValueOnce(reponse(204, undefined));

    const p = api.ecrireSemaineBesoins('c-1', '2026-W27', { absences: [] });
    const attente = expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init1 = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const init2 = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(init1.method).toBe('PUT');
    expect(init1.body).toBe(JSON.stringify({ absences: [] }));
    // Rejeu à l'identique (même corps, mêmes en-têtes).
    expect(init2.body).toBe(init1.body);
  });

  it('ecrirePlanning (upsert mensuel) : rejoué sur 503 → succès à la 2e tentative', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse(503, undefined))
      .mockResolvedValueOnce(reponse(204, undefined));

    const p = api.ecrirePlanning('c-1', '2026-07', false, { absences: [] });
    const attente = expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init1 = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init1.method).toBe('PUT');
    expect(init1.body).toBe(JSON.stringify({ absences: [] }));
  });

  it('validerSemaine (idempotente par clé unique) : rejouée sur TypeError', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reponse(200, { statut: 'validee' }));

    const p = api.validerSemaine('c-1', '2026-W27');
    const attente = expect(p).resolves.toEqual({ statut: 'validee' });
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('écriture NON idempotente (supprimerContrat) : ni rejeu ni signal ajouté', async () => {
    fetchMock.mockResolvedValue(reponse(503, undefined));

    await expect(api.supprimerContrat('c-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
    });
    // Aucun rejeu : comportement inchangé pour les écritures non rejouables.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });
});
