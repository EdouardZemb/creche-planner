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

  it('échec réseau (TypeError) → propagé tel quel (classé indisponible en aval)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(TypeError);
  });
});
